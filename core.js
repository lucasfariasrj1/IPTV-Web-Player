let hls;

const BATCH_SIZE = 80;
const CORS_PROXY = "https://api.allorigins.win/raw?url=";

const video = document.getElementById("videoPlayer");
const spinner = document.getElementById("spinner");
const channelsContainer = document.getElementById("channelsContainer");
const loginForm = document.getElementById("loginForm");
const serverUrlInput = document.getElementById("serverUrl");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const statusMessage = document.getElementById("statusMessage");
const filterButtons = Array.from(document.querySelectorAll(".filter-btn"));
const loadMoreBtn = document.getElementById("loadMoreBtn");
const listMeta = document.getElementById("listMeta");

const playlistByCategory = {
  channels: [],
  movies: [],
  series: []
};

let activeCategory = "channels";
let renderedCount = 0;
let renderedElements = [];
let currentSelectedIndex = -1;

function showSpinner(show = true) {
  spinner.style.display = show ? "flex" : "none";
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function normalizeServerUrl(rawServerUrl) {
  const trimmed = rawServerUrl.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function buildPlaylistUrl(serverUrl, username, password) {
  const params = new URLSearchParams({
    username,
    password,
    type: "m3u_plus",
    output: "ts"
  });

  return `${serverUrl}/get.php?${params.toString()}`;
}

function parseAttributes(extinfLine) {
  const attributes = {};
  const regex = /(\w[\w-]*)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(extinfLine)) !== null) {
    attributes[match[1].toLowerCase()] = match[2];
  }

  return attributes;
}

function categoryFromGroup(groupTitle = "") {
  const normalizedGroup = groupTitle.toLowerCase();
  if (/movie|filme|film|vod/.test(normalizedGroup)) return "movies";
  if (/series|série|serie/.test(normalizedGroup)) return "series";
  return "channels";
}

function parseM3U(content) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const parsed = { channels: [], movies: [], series: [] };
  let currentInfo = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const attributes = parseAttributes(line);
      const nameMatch = line.match(/,(.*)$/);
      currentInfo = {
        title: nameMatch ? nameMatch[1].trim() : "Conteúdo sem título",
        group: attributes["group-title"] || "Sem categoria",
        category: categoryFromGroup(attributes["group-title"] || ""),
        logo: attributes["tvg-logo"] || "",
        streamUrl: ""
      };
      continue;
    }

    if (currentInfo && /^https?:\/\//i.test(line)) {
      currentInfo.streamUrl = line;
      parsed[currentInfo.category].push(currentInfo);
      currentInfo = null;
    }
  }

  return parsed;
}

function ensurePlaylistContent(content) {
  const normalized = content.trim();
  if (!normalized) throw new Error("playlist vazia");

  if (/invalid|expired|unauthorized|forbidden|blocked/i.test(normalized)) {
    throw new Error("credenciais inválidas ou acesso bloqueado pelo provedor");
  }

  if (!normalized.includes("#EXTINF")) {
    throw new Error("resposta recebida não parece uma playlist M3U válida");
  }
}

async function downloadPlaylist(playlistUrl) {
  try {
    const directResponse = await fetch(playlistUrl, { method: "GET", mode: "cors" });
    if (!directResponse.ok) throw new Error(`HTTP ${directResponse.status}`);
    return await directResponse.text();
  } catch (directError) {
    const proxiedResponse = await fetch(`${CORS_PROXY}${encodeURIComponent(playlistUrl)}`);
    if (!proxiedResponse.ok) throw new Error(`Falha no proxy CORS (${proxiedResponse.status})`);
    return await proxiedResponse.text();
  }
}

function resetRenderedState() {
  renderedCount = 0;
  renderedElements = [];
  currentSelectedIndex = -1;
  channelsContainer.innerHTML = "";
}

function createItemCard(item) {
  const element = document.createElement("button");
  element.className = "channel-card";
  element.type = "button";

  const logoMarkup = item.logo
    ? `<img src="${item.logo}" alt="${item.title}" loading="lazy">`
    : `<div class="logo-fallback">▶</div>`;

  element.innerHTML = `<div class="thumb">${logoMarkup}</div><div class="meta"><span class="title">${item.title}</span><small class="group">${item.group}</small></div>`;
  element.addEventListener("click", () => {
    playChannel(item.streamUrl);
    currentSelectedIndex = renderedElements.indexOf(element);
    updateSelection();
  });

  return element;
}

function labelForCategory(category) {
  if (category === "movies") return "Filmes";
  if (category === "series") return "Séries";
  return "Canais";
}

function renderNextBatch() {
  const list = playlistByCategory[activeCategory];
  const nextItems = list.slice(renderedCount, renderedCount + BATCH_SIZE);
  const fragment = document.createDocumentFragment();

  nextItems.forEach((item) => {
    const card = createItemCard(item);
    fragment.appendChild(card);
    renderedElements.push(card);
  });

  channelsContainer.appendChild(fragment);
  renderedCount += nextItems.length;
  loadMoreBtn.hidden = renderedCount >= list.length;
  listMeta.textContent = `${labelForCategory(activeCategory)}: ${list.length} itens`;
}

function renderCategory(category) {
  activeCategory = category;
  filterButtons.forEach((button) => button.classList.toggle("active", button.dataset.category === category));

  resetRenderedState();
  if (playlistByCategory[category].length === 0) {
    listMeta.textContent = `${labelForCategory(category)}: nenhum item encontrado.`;
    loadMoreBtn.hidden = true;
    return;
  }

  renderNextBatch();
}

function applyParsedPlaylist(parsed) {
  playlistByCategory.channels = parsed.channels;
  playlistByCategory.movies = parsed.movies;
  playlistByCategory.series = parsed.series;

  const total = parsed.channels.length + parsed.movies.length + parsed.series.length;
  setStatus(`Playlist carregada com sucesso. ${total} itens encontrados.`);

  const preferredStart = parsed.channels.length > 0 ? "channels" : (parsed.movies.length > 0 ? "movies" : "series");
  renderCategory(preferredStart);
}

async function fetchPlaylist(serverUrl, username, password) {
  const playlistUrl = buildPlaylistUrl(serverUrl, username, password);
  setStatus("Autenticando e baixando playlist...");

  const content = await downloadPlaylist(playlistUrl);
  ensurePlaylistContent(content);
  return parseM3U(content);
}

function playChannel(streamUrl) {
  showSpinner(true);

  if (hls) {
    hls.destroy();
    hls = null;
  }

  if (Hls.isSupported() && /\.m3u8($|\?)/i.test(streamUrl)) {
    hls = new Hls({ enableWorker: true });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    hls.once(Hls.Events.MANIFEST_PARSED, () => video.play().finally(() => showSpinner(false)));
    hls.on(Hls.Events.ERROR, () => showSpinner(false));
    return;
  }

  video.src = streamUrl;
  video.play().finally(() => showSpinner(false));
}

function updateSelection() {
  renderedElements.forEach((card, index) => {
    card.classList.toggle("selected", index === currentSelectedIndex);
    if (index === currentSelectedIndex) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const serverUrl = normalizeServerUrl(serverUrlInput.value);
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!serverUrl) {
    setStatus("Informe uma URL de servidor válida (ex.: https://ded50.com).", true);
    return;
  }

  if (!username || !password) {
    setStatus("Preencha usuário e senha para continuar.", true);
    return;
  }

  resetRenderedState();
  listMeta.textContent = "Carregando lista...";
  loadMoreBtn.hidden = true;

  try {
    const parsed = await fetchPlaylist(serverUrl, username, password);
    applyParsedPlaylist(parsed);
  } catch (error) {
    setStatus(`Não foi possível carregar a playlist: ${error.message}`, true);
    listMeta.textContent = "Falha no carregamento.";
  }
});

filterButtons.forEach((button) => button.addEventListener("click", () => renderCategory(button.dataset.category)));
loadMoreBtn.addEventListener("click", renderNextBatch);

document.addEventListener("keydown", (event) => {
  if (renderedElements.length === 0) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    currentSelectedIndex = (currentSelectedIndex + 1) % renderedElements.length;
    updateSelection();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    currentSelectedIndex = (currentSelectedIndex - 1 + renderedElements.length) % renderedElements.length;
    updateSelection();
    return;
  }

  if (event.key === "Enter" && currentSelectedIndex >= 0) {
    event.preventDefault();
    renderedElements[currentSelectedIndex].click();
    return;
  }

  if (event.key === " ") {
    event.preventDefault();
    video.paused ? video.play() : video.pause();
  }
});

video.addEventListener("playing", () => showSpinner(false));
video.addEventListener("waiting", () => showSpinner(true));
