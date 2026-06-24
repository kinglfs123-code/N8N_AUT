// ============================================================
// Câmbio — lógica do painel
// Lê os snapshots de cotação de hoje no Supabase e desenha a tela.
// Os dados chegam via webhook (n8n -> Edge Function -> tabela rate_snapshots).
// ============================================================

// Moedas exibidas. Para adicionar/remover, mexa só aqui (o backend usa JSONB,
// então aceita qualquer conjunto de moedas sem mudar o banco).
const CURRENCIES = [
  { code: "USD", symbol: "$",  name: "Dólar americano" },
  { code: "EUR", symbol: "€",  name: "Euro" },
  { code: "GBP", symbol: "£",  name: "Libra esterlina" },
  { code: "CHF", symbol: "Fr", name: "Franco suíço" },
];

// Horários programados no n8n (só para desenhar a régua de "Programação do dia").
const TARGETS = [6, 8, 9, 10, 12];

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const fmtBRL  = (n) => "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum  = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function showState(which) {
  ["state-loading", "state-empty", "state-error", "content"].forEach((id) => {
    $(id).hidden = id !== which;
  });
}

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ---------- carregamento ----------
async function load() {
  $("sub-date").textContent =
    new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
    " · valores em Real (BRL)";

  try {
    const { data, error } = await supabaseClient
      .from("rate_snapshots")
      .select("captured_at, rates")
      .gte("captured_at", startOfTodayISO())
      .order("captured_at", { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      renderSchedule([]);
      setConnBadge(null);
      showState("state-empty");
      return;
    }

    render(data);
    showState("content");
  } catch (e) {
    console.error("Erro ao carregar cotações:", e?.message || e);
    showState("state-error");
  }
}

function render(snaps) {
  setConnBadge(snaps);
  renderSchedule(snaps);
  renderCards(snaps);
  renderTable(snaps);

  const last = snaps[snaps.length - 1];
  $("badge-last").textContent = "Última atualização · " + fmtTime(last.captured_at);
  $("panel-count").textContent = snaps.length + (snaps.length === 1 ? " envio recebido hoje" : " envios recebidos hoje");
  $("footnote-text").textContent = "Atualizações automáticas via n8n nos horários programados";
}

// Selo de conexão: verde se o último envio foi há pouco; amarelo se ficou velho.
function setConnBadge(snaps) {
  const badge = $("badge-conn");
  if (!snaps || snaps.length === 0) {
    badge.className = "badge stale";
    badge.innerHTML = '<span class="dot"></span> aguardando n8n';
    return;
  }
  const last = new Date(snaps[snaps.length - 1].captured_at);
  const horas = (Date.now() - last.getTime()) / 36e5;
  if (horas <= 6) {
    badge.className = "badge live";
    badge.innerHTML = '<span class="dot"></span> n8n conectado';
  } else {
    badge.className = "badge stale";
    badge.innerHTML = '<span class="dot"></span> sem envio recente';
  }
}

function renderSchedule(snaps) {
  const el = $("schedule");
  el.innerHTML = '<span class="label lbl">Programação do dia</span>';
  const horas = snaps.map((s) => new Date(s.captured_at).getHours());
  const maxHora = horas.length ? Math.max(...horas) : -1;
  const ultimoFeito = Math.max(...TARGETS.filter((t) => t <= maxHora), -1);

  TARGETS.forEach((t) => {
    const span = document.createElement("span");
    const label = String(t).padStart(2, "0") + ":00";
    if (t === ultimoFeito) span.className = "time-pill latest";
    else if (t <= maxHora) span.className = "time-pill done";
    else span.className = "time-pill";
    span.textContent = label;
    el.appendChild(span);
  });
}

function renderCards(snaps) {
  const primeiro = snaps[0].rates;
  const ultimo = snaps[snaps.length - 1].rates;
  const cards = $("cards");
  cards.innerHTML = "";

  CURRENCIES.forEach((c) => {
    const atual = Number(ultimo[c.code]);
    if (!Number.isFinite(atual)) return; // moeda ausente nesse envio: pula

    const base = Number(primeiro[c.code]);
    let pct = 0;
    if (Number.isFinite(base) && base !== 0) pct = ((atual - base) / base) * 100;

    let varClass = "flat", arrow = "■";
    if (pct > 0.001) { varClass = "up"; arrow = "▲"; }
    else if (pct < -0.001) { varClass = "down"; arrow = "▼"; }

    const serie = snaps.map((s) => Number(s.rates[c.code])).filter(Number.isFinite);

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="ccard-head">
        <div class="ccode">
          <span class="flag">${c.symbol}</span>
          <div><div class="pair">${c.code} / BRL</div><div class="name">${c.name}</div></div>
        </div>
        <span class="var ${varClass}">${arrow} ${Math.abs(pct).toFixed(2)}%</span>
      </div>
      <div class="price"><span class="cur">R$</span>${fmtNum(atual)}</div>
      <svg class="spark" viewBox="0 0 200 38" preserveAspectRatio="none" fill="none">${sparkline(serie, pct >= 0)}</svg>
    `;
    cards.appendChild(card);
  });
}

function sparkline(serie, up) {
  const w = 200, h = 38, pad = 4;
  const color = up ? "#3FB950" : "#F85149";
  if (serie.length < 2) {
    const y = h / 2;
    return `<polyline points="0,${y} ${w},${y}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;
  }
  const min = Math.min(...serie), max = Math.max(...serie), range = max - min || 1;
  const pts = serie.map((v, i) => {
    const x = (i / (serie.length - 1)) * w;
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<polyline points="${pts}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}

function renderTable(snaps) {
  $("table-head").innerHTML =
    "<tr><th>Horário</th>" + CURRENCIES.map((c) => `<th class="num">${c.code}</th>`).join("") + "</tr>";

  const body = $("table-body");
  body.innerHTML = "";
  snaps.forEach((s, i) => {
    const ultima = i === snaps.length - 1;
    const cols = CURRENCIES.map((c) => {
      const v = Number(s.rates[c.code]);
      return `<td class="num">${Number.isFinite(v) ? fmtNum(v) : "—"}</td>`;
    }).join("");
    const tag = ultima ? '<span class="tag-latest">MAIS RECENTE</span>' : "";
    const tr = document.createElement("tr");
    if (ultima) tr.className = "latest";
    tr.innerHTML = `<td class="hr">${fmtTime(s.captured_at)}${tag}</td>${cols}`;
    body.appendChild(tr);
  });
}

// ---------- eventos ----------
$("btn-refresh").addEventListener("click", async () => {
  const btn = $("btn-refresh");
  btn.classList.add("spin");
  showState("state-loading");
  await load();
  btn.classList.remove("spin");
});

load();
