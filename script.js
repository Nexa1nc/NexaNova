const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const resultsContainer = document.getElementById('results');
const statusText = document.getElementById('status-text');
const spinner = document.getElementById('spinner');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  resultsContainer.innerHTML = '';
  if (spinner) spinner.style.display = 'block';
  if (statusText) statusText.textContent = 'Ricerca in corso su NexaNova...';

  // Avviamo il timer di risposta
  const startTime = performance.now();

  // --- LIVELLO 1: Ricerca Primaria ---
  try {
    const searxUrl = `https://searx.be/search?q=${encodeURIComponent(query)}&format=json`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(searxUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
        renderResults(data.results, elapsedTime);
        return;
      }
    }
  } catch (err) {
    console.warn('Backup 1 in corso...');
  }

  // --- LIVELLO 2: Ricerca di Backup 1 ---
  try {
    const ddgUrl = `/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(ddgUrl);
    
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
        renderResults(data.results, elapsedTime);
        return;
      }
    }
  } catch (err) {
    console.warn('Backup 2 in corso...');
  }

  // --- LIVELLO 3: Ricerca di Backup 2 ---
  try {
    const wikiUrl = `https://it.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
    const res = await fetch(wikiUrl);
    
    if (res.ok) {
      const data = await res.json();
      if (data.query && data.query.search.length > 0) {
        const wikiResults = data.query.search.map(item => ({
          title: item.title,
          url: `https://it.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
          content: item.snippet.replace(/<[^>]+>/g, '') + '...'
        }));

        const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
        renderResults(wikiResults, elapsedTime);
        return;
      }
    }
  } catch (err) {
    console.error('Errore durante la ricerca.');
  }

  if (spinner) spinner.style.display = 'none';
  const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
  if (statusText) statusText.textContent = `Nessun risultato trovato (${elapsedTime}s). Prova con altre parole.`;
});

function renderResults(items, seconds) {
  if (spinner) spinner.style.display = 'none';
  if (statusText) statusText.textContent = `Trovati ${items.length} risultati su NexaNova in ${seconds} secondi`;
  resultsContainer.innerHTML = '';

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const header = document.createElement('div');
    header.className = 'result-header';

    const titleLink = document.createElement('a');
    titleLink.className = 'result-title';
    titleLink.href = item.url;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = item.title;

    header.appendChild(titleLink);

    const urlDiv = document.createElement('div');
    urlDiv.className = 'result-url';
    urlDiv.textContent = item.url;

    const desc = document.createElement('p');
    desc.className = 'result-snippet';
    desc.textContent = item.content || item.snippet || 'Nessuna descrizione disponibile.';

    const badge = document.createElement('span');
    badge.className = 'provider-badge';
    badge.textContent = 'NexaNova Verified';

    card.appendChild(header);
    card.appendChild(urlDiv);
    card.appendChild(desc);
    card.appendChild(badge);

    resultsContainer.appendChild(card);
  });
}
