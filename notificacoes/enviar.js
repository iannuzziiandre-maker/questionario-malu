// Fluxo: roda no GitHub Actions a cada 15 minutos.
// 1) Cria as chaves de notificação (só na primeira vez) e guarda no Firebase.
// 2) Para cada pessoa: puxa o Google Agenda (se ela colou o link) e manda os lembretes que venceram.
// Precisa do segredo FIREBASE_SA (chave da conta de serviço do Firebase), cadastrado no GitHub.
const { lembretes, local } = require("./lembretes");
const APP_URL = "https://iannuzziiandre-maker.github.io/questionario-malu/fluxo/";

async function main() {
  if (!process.env.FIREBASE_SA) { console.log("Falta o segredo FIREBASE_SA no GitHub. Nada foi enviado."); return; }
  const admin = require("firebase-admin"), webpush = require("web-push");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
  const db = admin.firestore();

  const vref = db.doc("sistema/vapid");
  let vapid = (await vref.get()).data();
  if (!vapid || !vapid.publicKey) { vapid = webpush.generateVAPIDKeys(); await vref.set(vapid); console.log("Chaves de notificação criadas."); }
  webpush.setVapidDetails(APP_URL, vapid.publicKey, vapid.privateKey);

  const eref = db.doc("sistema/estado");
  const agora = Date.now();
  const ultimo = ((await eref.get()).data() || {}).ultimo || agora - 15 * 60e3;
  const de = Math.max(ultimo, agora - 3 * 3600e3); // se ficou muito tempo parado, não manda lembrete velho

  const pessoas = await db.collection("usuarios").listDocuments();
  let enviados = 0;
  for (const p of pessoas) {
    try {
      const dados = p.collection("dados");
      const cfg = (await dados.doc("config").get()).data() || {};
      if (cfg.vapidPublic !== vapid.publicKey) await dados.doc("config").set({ vapidPublic: vapid.publicKey }, { merge: true });
      const appSnap = await dados.doc("app").get();
      if (!appSnap.exists) continue;
      const D = JSON.parse(appSnap.data().json || "{}");

      await sincronizarGoogle(D, dados, agora);

      const push = (await dados.doc("push").get()).data() || {};
      let subs = push.subs || [];
      if (!subs.length) continue;
      const lista = lembretes(D, de, agora);
      const ruins = new Set();
      for (const l of lista) {
        const carga = JSON.stringify({ title: l.title, body: l.body, tag: l.tag, url: APP_URL });
        for (const s of subs) {
          try { await webpush.sendNotification(s, carga, { TTL: 3600 }); enviados++; }
          catch (e) { if (e.statusCode === 404 || e.statusCode === 410) ruins.add(s.endpoint); else console.log("Falha ao enviar:", e.statusCode || e.message); }
        }
      }
      if (ruins.size) { subs = subs.filter(s => !ruins.has(s.endpoint)); await dados.doc("push").set({ subs }, { merge: true }); }
    } catch (e) { console.log("Erro com uma pessoa:", e.message); }
  }
  await eref.set({ ultimo: agora, ultimoTexto: new Date(agora - 4 * 3600e3).toISOString().slice(0, 16) + " (Manaus)" }, { merge: true });
  console.log(`Pronto. ${pessoas.length} pessoa(s), ${enviados} notificação(ões) enviada(s).`);
}

// Google Agenda: a pessoa cola no app o "endereço secreto no formato iCal". A cada 30 min puxamos os próximos 60 dias.
async function sincronizarGoogle(D, dados, agora) {
  const url = D.cfg && D.cfg.ical;
  const gref = dados.doc("google");
  const atual = (await gref.get()).data() || {};
  if (!url) { if (atual.eventos && atual.eventos.length) await gref.set({ eventos: [], atualizado: agora, erro: "" }); return; }
  if (atual.url === url && agora - (atual.atualizado || 0) < 30 * 60e3) return;
  try {
    const ical = require("node-ical");
    const cal = await ical.async.fromURL(url);
    const ini = agora - 864e5, fim = agora + 60 * 864e5, eventos = [];
    const push = (ev, start, end) => {
      const allDay = ev.datetype === "date" || (start && start.dateOnly);
      const s = local(start.getTime() + (allDay ? 4 * 3600e3 : 0)), e = end ? local(end.getTime()) : null;
      eventos.push({ id: "g-" + (ev.uid || "") + "-" + s.iso + "-" + s.min, title: String(ev.summary || "(sem título)"), date: s.iso,
        time: allDay ? "" : `${String(Math.floor(s.min / 60)).padStart(2, "0")}:${String(s.min % 60).padStart(2, "0")}`,
        fim: allDay || !e || e.iso !== s.iso ? "" : `${String(Math.floor(e.min / 60)).padStart(2, "0")}:${String(e.min % 60).padStart(2, "0")}`,
        cat: "Google" });
    };
    for (const ev of Object.values(cal)) {
      if (ev.type !== "VEVENT" || !ev.start) continue;
      const dur = ev.end ? ev.end - ev.start : 0;
      if (ev.rrule) {
        for (const d of ev.rrule.between(new Date(ini), new Date(fim), true)) {
          const k = d.toISOString().slice(0, 10);
          if (ev.exdate && Object.keys(ev.exdate).some(x => x.startsWith(k))) continue;
          const ov = ev.recurrences && Object.values(ev.recurrences).find(r => r.recurrenceid && new Date(r.recurrenceid).toISOString().slice(0, 10) === k);
          if (ov) push(ov, ov.start, ov.end); else push(ev, d, new Date(d.getTime() + dur));
        }
      } else if (ev.start.getTime() <= fim && (ev.end || ev.start).getTime() >= ini) push(ev, ev.start, ev.end);
    }
    eventos.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    await gref.set({ url, eventos: eventos.slice(0, 500), atualizado: agora, erro: "" });
    console.log(`Google Agenda: ${eventos.length} compromisso(s).`);
  } catch (e) {
    await gref.set({ url, atualizado: agora, erro: "Não consegui ler o link do Google Agenda. Confira se colou o endereço secreto em formato iCal." }, { merge: true });
    console.log("Google Agenda falhou:", e.message);
  }
}

main().catch(e => { console.log("Erro geral:", e.message); });
