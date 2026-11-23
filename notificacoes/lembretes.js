// Fluxo: calcula quais lembretes vencem numa janela de tempo. Sem rede: só contas, para dar para testar.
// Horário de Manaus = UTC-4 (sem horário de verão).
const TZ = 4 * 3600e3;
const pad = (n) => String(n).padStart(2, "0");
const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const local = (ts) => { const d = new Date(ts - TZ); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, min: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const at = (iso, hhmm) => { const [y, m, d] = iso.split("-").map(Number); const [h, mi] = String(hhmm || "00:00").split(":").map(Number); return Date.UTC(y, m - 1, d, h, mi || 0) + TZ; };
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
const brl = (v) => "R$ " + (Number(v) || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const hm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

// "08:30–12:30 · 19:00–21:00 · 23:30–06:00" -> [[510,750],[1140,1260],[1410,360]]
function silencios(txt) {
  const out = []; const re = /(\d{1,2})[:h]?(\d{2})?\s*(?:–|-|às|a|até)\s*(\d{1,2})[:h]?(\d{2})?/gi; let m;
  while ((m = re.exec(String(txt || "")))) out.push([Number(m[1]) * 60 + Number(m[2] || 0), Number(m[3]) * 60 + Number(m[4] || 0)]);
  return out;
}
const emSilencio = (min, faixas) => faixas.some(([a, b]) => a <= b ? (min >= a && min < b) : (min >= a || min < b));

const PADRAO = { ativas: true, manha: true, horaManha: "06:10", agua: true, contas: true, eventos: true, casos: true, desligar: true, horaDesligar: "23:00", pets: true, tarefas: true, mes: true };

function lembretes(D, de, ate) {
  const N = Object.assign({}, PADRAO, D.notif || {});
  if (!N.ativas) return [];
  const mod = D.modulos || {};
  const on = (k) => mod[k] !== false;
  const nome = D.nome || "";
  const out = [];
  const faixas = silencios(D.silencio);
  // Lembretes importantes que caem no silêncio são adiados para o fim dele; água, "em 1 hora" e "desligar" são descartados.
  const DESCARTA = /^(agua|ev1h|desligar)-/;
  const add = (ts, title, body, tag) => {
    const l = local(ts);
    const f = faixas.find(([a, b]) => a <= b ? (l.min >= a && l.min < b) : (l.min >= a || l.min < b));
    if (f) { if (DESCARTA.test(tag)) return; ts = ts + (((f[1] - l.min) + 1440) % 1440) * 60e3; }
    if (ts > de && ts <= ate) out.push({ ts, title, body, tag });
  };
  // dias locais cobertos pela janela (com folga de 1 dia para "amanhã" e "2 dias antes")
  const dias = new Set(); for (let t = de - 864e5; t <= ate + 3 * 864e5; t += 3600e3) dias.add(local(t).iso);
  const eventos = D.eventos || [];
  for (const dia of dias) {
    const evs = eventos.filter(e => e.date === dia).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    if (N.manha) {
      const casos = (D.casos || []).filter(c => c.etapa < 6 && c.prazo && c.prazo <= addDays(dia, 2)).length;
      const partes = [];
      partes.push(evs.length ? `${evs.length} compromisso${evs.length > 1 ? "s" : ""}${evs[0].time ? ` (o primeiro às ${evs[0].time})` : ""}` : "agenda livre");
      if (on("casos") && casos) partes.push(`${casos} caso${casos > 1 ? "s" : ""} com prazo perto`);
      add(at(dia, N.horaManha), `Bom dia${nome ? ", " + nome : ""}! ☀️`, `Hoje: ${partes.join(", ")}. Bora, sem pressa.`, "manha-" + dia);
    }
    if (N.agua && on("habitos")) {
      const copos = (D.agua || {})[dia] || 0, meta = D.metaAgua || 7;
      for (const h of ["09:00", "11:00", "13:30", "15:30", "17:30", "20:00"]) if (copos < meta) add(at(dia, h), "Hora da água 💧", `Você está em ${copos} de ${meta} copos. Um golinho agora?`, "agua-" + dia + h);
    }
    if (N.desligar) add(at(dia, N.horaDesligar), "Hora de desligar 🌙", "Celular longe, luz baixa. Amanhã a gente continua.", "desligar-" + dia);
    if (N.eventos && on("agenda")) {
      for (const e of evs) {
        if (e.time) add(at(dia, e.time) - 3600e3, `Em 1 hora: ${e.title}`, `Às ${e.time}${e.fim ? " até " + e.fim : ""}.`, "ev1h-" + e.id + dia);
        add(at(addDays(dia, -1), "20:00"), `Amanhã: ${e.title}`, e.time ? `Às ${e.time}.` : "Está na sua agenda.", "evd-" + e.id + dia);
      }
    }
    if (N.contas && on("financas")) {
      const [y, m, d] = dia.split("-").map(Number);
      for (const c of (D.fin && D.fin.contas) || []) {
        if (Number(c.dia) !== d) continue;
        const k = `${y}-${pad(m)}`;
        if ((c.pagos || {})[k]) continue;
        add(at(addDays(dia, -2), "09:00"), `Conta em 2 dias: ${c.desc}`, `${c.val ? brl(c.val) + ", " : ""}vence dia ${d}. Já marcou como paga?`, "conta-" + c.id + k);
      }
    }
    if (N.casos && on("casos")) {
      for (const c of D.casos || []) {
        if (c.etapa >= 6) continue;
        if (c.prazo === dia) add(at(addDays(dia, -1), "08:00"), `Prazo amanhã: caso ${c.ini}`, `${c.tipo || "Documento"} vence amanhã.`, "caso-" + c.id + dia);
        const pe = (c.prazosEtapa || {})[c.etapa];
        if (pe === dia) add(at(addDays(dia, -1), "08:00"), `Etapa vence amanhã: caso ${c.ini}`, "Confira a etapa atual no app.", "etapa-" + c.id + dia);
      }
    }
    if (N.pets && on("pets")) for (const p of D.pets || []) if (p.date === dia) add(at(dia, "09:00"), `${p.pet}: ${String(p.oque).toLowerCase()} hoje 🐾`, "Depois marque como feito no app.", "pet-" + p.id + dia);
    if (N.tarefas && on("tarefas")) {
      const ts = (D.tarefas || []).filter(t => !t.done && t.date === dia);
      if (ts.length) add(at(dia, "07:30"), `Tarefa${ts.length > 1 ? "s" : ""} de hoje`, ts.slice(0, 3).map(t => t.t).join(" · ") + (ts.length > 3 ? ` e mais ${ts.length - 3}` : ""), "tar-" + dia);
    }
    if (N.mes && on("financas") && addDays(dia, 1).slice(8) === "01") {
      const ym = dia.slice(0, 7);
      const meus = ((D.fin && D.fin.gastos) || []).filter(g => (!g.quem || g.quem === "Eu") && String(g.date).slice(0, 7) === ym);
      const total = meus.reduce((s, g) => s + (Number(g.val) || 0), 0);
      const lim = D.fin && D.fin.orcamento;
      add(at(dia, "20:00"), `Resumo de ${MES[Number(dia.slice(5, 7)) - 1]}`, `Você gastou ${brl(total)}${lim ? ` de ${brl(lim)}` : ""}. Economizado na lista de espera: ${brl(D.fin && D.fin.economia)}.`, "mes-" + ym);
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}
module.exports = { lembretes, silencios, emSilencio, local, at, hm };
