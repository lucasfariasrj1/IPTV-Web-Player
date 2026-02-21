let hls;

const PLAYLIST_BASE_URL = "http://ded50.com/get.php";
const BATCH_SIZE = 80;

const video = document.getElementById("videoPlayer");
const spinner = document.getElementById("spinner");
const channelsContainer = document.getElementById("channelsContainer");
const loginForm = document.getElementById("loginForm");
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

function buildPlaylistUrl(username, password) {
  const params = new URLSearchParams({
    username,
    password,
    type: "m3u_plus",
    output: "ts"
  });

  return `${PLAYLIST_BASE_URL}?${params.toString()}`;
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
  const lines = content.split(/\r?\n/);
  const parsed = {
    channels: [],
    movies: [],
    series: []
  };

  let currentInfo = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const attributes = parseAttributes(line);
      const nameMatch = line.match(/,(.*)$/);
      const title = nameMatch ? nameMatch[1].trim() : "Conteúdo sem título";
      const group = attributes["group-title"] || "Sem categoria";
      const category = categoryFromGroup(group);

      currentInfo = {
        title,
        group,
        category,
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

  element.innerHTML = `
    <div class="thumb">${logoMarkup}</div>
    <div class="meta">
      <span class="title">${item.title}</span>
      <small class="group">${item.group}</small>
    </div>
  `;

  element.addEventListener("click", () => {
    playChannel(item.streamUrl);
    currentSelectedIndex = renderedElements.indexOf(element);
    updateSelection();
  });

  return element;
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
  filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.category === category);
  });

  resetRenderedState();
  if (playlistByCategory[category].length === 0) {
    listMeta.textContent = `${labelForCategory(category)}: nenhum item encontrado.`;
    loadMoreBtn.hidden = true;
    return;
  }

  renderNextBatch();
}

function labelForCategory(category) {
  if (category === "movies") return "Filmes";
  if (category === "series") return "Séries";
  return "Canais";
}

function applyParsedPlaylist(parsed) {
  playlistByCategory.channels = parsed.channels;
  playlistByCategory.movies = parsed.movies;
  playlistByCategory.series = parsed.series;

  const total = parsed.channels.length + parsed.movies.length + parsed.series.length;
  setStatus(`Playlist carregada com sucesso. ${total} itens encontrados.`);

  const preferredStart = parsed.channels.length > 0
    ? "channels"
    : (parsed.movies.length > 0 ? "movies" : "series");

  renderCategory(preferredStart);
}

async function fetchPlaylist(username, password) {
  const playlistUrl = buildPlaylistUrl(username, password);
  setStatus("Autenticando e baixando playlist...");

  const response = await fetch(playlistUrl);
  if (!response.ok) {
    throw new Error(`Falha ao baixar playlist (${response.status})`);
  }

  const content = await response.text();
  return parseM3U(content);
}

function playChannel(streamUrl) {
  showSpinner(true);

  if (hls) {
    hls.destroy();
    hls = null;
  }

  if (Hls.isSupported()) {
    hls = new Hls({ enableWorker: true });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    hls.once(Hls.Events.MANIFEST_PARSED, () => {
      video.play().finally(() => showSpinner(false));
    });

    hls.on(Hls.Events.ERROR, () => showSpinner(false));
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = streamUrl;
    video.play().finally(() => showSpinner(false));
  } else {
    setStatus("Seu navegador não suporta reprodução HLS.", true);
    showSpinner(false);
  }
}

function updateSelection() {
  renderedElements.forEach((card, index) => {
    card.classList.toggle("selected", index === currentSelectedIndex);
    if (index === currentSelectedIndex) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  if (!username || !password) {
    setStatus("Preencha usuário e senha para continuar.", true);
    return;
  }

  resetRenderedState();
  listMeta.textContent = "Carregando lista...";
  loadMoreBtn.hidden = true;

  try {
    const parsed = await fetchPlaylist(username, password);
    applyParsedPlaylist(parsed);
  } catch (error) {
    setStatus(`Não foi possível carregar a playlist: ${error.message}`, true);
    listMeta.textContent = "Falha no carregamento.";
  }
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => renderCategory(button.dataset.category));
});

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
