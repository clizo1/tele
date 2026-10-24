// La tele sin servidor: todo lo que pasa viene en el link que pone el objeto de SL (sl/tele/tele.lsl):
//   ?v=<video de YouTube>&t=<hora unix en que el video estaría en el segundo 0>&p=<segundo, si está en pausa>
//   &o=<URL segura del objeto>: los botones de abajo le mandan ahí la orden y el objeto le cambia el link a todos.
// Cada visor calcula solo por dónde va. Para que los relojes coincidan, se mide contra la hora (encabezado Date)
// que manda GitHub Pages; si alguien quedó corrido más de 2 s, salta al punto justo.

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const estado = {
  video: q.get("v") || "",
  inicio: Number(q.get("t")) * 1000,
  pausa: q.has("p") ? Number(q.get("p")) : null,
};
const MARGEN = 2;              // segundos de desfase que se toleran antes de saltar

let desfaseReloj = 0, reproductor = null, listo = false, sinSonido = false, cargado = false;
const ahora = () => Date.now() + desfaseReloj;

async function horaDe() {      // [hora del servidor (s), cuándo salió el pedido, cuándo volvió]
  const t0 = Date.now();
  const r = await fetch(`./?hora=${Math.random()}`, { method: "HEAD", cache: "no-store" });
  return [Date.parse(r.headers.get("date")), t0, Date.now()];
}

async function medirReloj() {
  // El encabezado Date viene en segundos enteros: se pregunta seguido hasta ver el cambio de segundo,
  // y ese momento (la mitad del viaje) es el ".000" del servidor.
  try {
    let [antes] = await horaDe();
    const hasta = Date.now() + 4000;
    while (Date.now() < hasta) {
      const [s, t0, t1] = await horaDe();
      if (s !== antes) { desfaseReloj = s - (t0 + t1) / 2; return; }
      antes = s;
      await new Promise(r => setTimeout(r, 80));
    }
    desfaseReloj = antes + 500 - Date.now();        // no se vio el cambio: con medio segundo de error alcanza
  } catch { /* sin encabezado: se usa el reloj de la compu */ }
}

function cartel(texto) {
  $("cartel").classList.toggle("oculto", !texto);
  if (texto) $("cartel").querySelector("span").textContent = texto;
}

const deberia = () => estado.pausa !== null ? estado.pausa : (ahora() - estado.inicio) / 1000;

function ajustar() {             // pausa/sigue y corrige el desfase
  if (!cargado) return;
  const t = deberia(), actual = reproductor.getCurrentTime?.() ?? 0;
  const s = reproductor.getPlayerState();
  if (estado.pausa !== null) {
    if (s === YT.PlayerState.PLAYING) reproductor.pauseVideo();
    if (Math.abs(actual - t) > 0.5) reproductor.seekTo(t, true);
    return;
  }
  if (s === YT.PlayerState.ENDED) return;          // terminó: queda quieto hasta que pongan otro
  const dura = reproductor.getDuration?.() ?? 0;
  if (dura > 0 && t >= dura - 0.5) {              // ya terminó para los demás (o se abrió tarde): al final y quieto
    if (s === YT.PlayerState.PLAYING) reproductor.pauseVideo();
    if (actual < dura - 1) reproductor.seekTo(dura - 0.2, true);
    return;
  }
  if (Math.abs(actual - t) > MARGEN && s !== YT.PlayerState.BUFFERING) reproductor.seekTo(t, true);
  if (s !== YT.PlayerState.PLAYING && s !== YT.PlayerState.BUFFERING) reproductor.playVideo();
}

function arrancar() {
  if (!listo || cargado) return;
  cartel("");
  cargado = true;
  reproductor.loadVideoById({ videoId: estado.video, startSeconds: Math.max(0, deberia()) });
  setInterval(ajustar, 1500);
}

// la API de YouTube llama a esta función cuando terminó de cargar
window.onYouTubeIframeAPIReady = () => {
  if (!estado.video) return;
  reproductor = new YT.Player("yt", {
    width: "100%", height: "100%",
    playerVars: { autoplay: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3,
                  cc_load_policy: 0, hl: "es" },
    events: {
      onReady: () => { listo = true; relojListo.then(arrancar); },
      onError: ev => {
        cargado = false;
        reproductor.stopVideo();
        cartel(ev.data === 101 || ev.data === 150
          ? "Ese video no se puede ver fuera de YouTube (lo bloqueó su dueño): probá con otro link, " +
            "por ejemplo una versión subida por otra persona"
          : "No se pudo cargar el video: probá con otro link");
      },
      onStateChange: ev => {
        // si el visor no deja arrancar con sonido, arranca mudo antes que quedarse quieto
        if (ev.data === YT.PlayerState.UNSTARTED && !sinSonido && estado.pausa === null) {
          setTimeout(() => {
            if (cargado && reproductor.getPlayerState() === YT.PlayerState.UNSTARTED) {
              sinSonido = true; reproductor.mute(); reproductor.playVideo();
            }
          }, 4000);
        }
      },
    },
  });
};

const relojListo = estado.video && estado.pausa === null ? medirReloj() : Promise.resolve();

// --- controles: aparecen al mover el mouse sobre la pantalla; sin video quedan siempre a la vista ---
const OBJETO = q.get("o");
let ocultarEn = 0, avisoHasta = 0;

function aviso(texto) {
  $("aviso").textContent = texto;
  $("aviso").classList.remove("oculto");
  avisoHasta = Date.now() + 5000;
}

function mostrarControles() {
  if (!OBJETO) return;
  $("controles").classList.remove("oculto");
  ocultarEn = Date.now() + 4000;
}

async function mandar(accion, texto = "") {
  aviso("Enviando…");
  try {
    // text/plain y sin leer la respuesta: así el navegador no pide permiso (CORS) al servidor de SL
    await fetch(OBJETO, { method: "POST", mode: "no-cors", body: JSON.stringify({ accion, texto }) });
    aviso("Listo: en un segundo cambia para todos");
  } catch {
    aviso("No llegó a la tele: probá de nuevo o escribí el link en el chat");
  }
}

document.querySelectorAll("#controles [data-accion]").forEach(b =>
  b.addEventListener("click", () => mandar(b.dataset.accion)));
function ponerLink() {
  const link = $("link").value.trim();
  if (!/youtu/i.test(link)) return aviso("Eso no parece un link de YouTube");
  $("link").value = "";
  mandar("poner", link);
}
$("poner").addEventListener("click", ponerLink);
$("link").addEventListener("keydown", ev => { if (ev.key === "Enter") ponerLink(); });
["mousemove", "mousedown", "keydown"].forEach(ev => document.addEventListener(ev, mostrarControles));

setInterval(() => {
  const fijo = !estado.video || document.activeElement === $("link");
  if (!fijo && ocultarEn && Date.now() > ocultarEn) { $("controles").classList.add("oculto"); ocultarEn = 0; }
  if (avisoHasta && Date.now() > avisoHasta) { $("aviso").classList.add("oculto"); avisoHasta = 0; }
}, 500);
if (OBJETO && !estado.video) mostrarControles();
