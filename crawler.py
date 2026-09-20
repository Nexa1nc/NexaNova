import os
import requests
import json
from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer

QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")

if not QDRANT_URL or not QDRANT_API_KEY:
    raise ValueError("ERRORE: Secrets QDRANT_URL o QDRANT_API_KEY non trovati!")

client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
collection_name = "global_web"

# Assicura la presenza della collezione su Qdrant
try:
    collections = client.get_collections().collections
    if not any(c.name == collection_name for c in collections):
        client.create_collection(
            collection_name=collection_name,
            vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE)
        )
except Exception as e:
    print(f"Errore nella gestione della collezione: {e}")

model = SentenceTransformer('all-MiniLM-L6-v2')

# Parole chiave e pattern da ignorare per pulire lo spam
SPAM_KEYWORDS = [
    "netsoltrademark", "__media__", "robots.txt", "euro-shop", 
    "checkmate", "0-0-0", "parking", "redirect", ".php?d="
]

def is_clean_url(url):
    """Verifica che l'URL non sia spam o un file non desiderato."""
    url_lower = url.lower()
    if any(spam in url_lower for spam in SPAM_KEYWORDS):
        return False
    if url_lower.endswith(('.jpg', '.png', '.gif', '.css', '.js', '.txt')):
        return False
    return True

points = []
idx = 1

# 1. RECUPERO PRECEDENZA ITALIANI (.it)
print("1. Fetching siti italiani (.it)...")
url_it = "https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*.it/*&output=json&limit=150"
try:
    res_it = requests.get(url_it, timeout=30)
    for line in res_it.text.strip().split('\n'):
        if not line:
            continue
        try:
            data = json.loads(line)
            raw_url = data.get("url", "")
            if not is_clean_url(raw_url):
                continue

            domain = raw_url.split('/')[2] if '://' in raw_url else raw_url
            title = data.get("title") or domain.replace("www.", "").capitalize()
            desc = f"Risultato in italiano da {domain}. Visita la pagina originale per approfondire."

            vector = model.encode(title + " " + desc).tolist()

            points.append({
                "id": idx,
                "vector": vector,
                "payload": {
                    "url": raw_url,
                    "title": title,
                    "description": desc,
                    "domain": domain,
                    "lang": "it"
                }
            })
            idx += 1
        except Exception:
            continue
except Exception as e:
    print(f"Errore download .it: {e}")

# 2. RECUPERO SITI INGLESI E GLOBALI (.com, .org)
print("2. Fetching siti inglesi (.com)...")
url_en = "https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*.com/*&output=json&limit=100"
try:
    res_en = requests.get(url_en, timeout=30)
    for line in res_en.text.strip().split('\n'):
        if not line:
            continue
        try:
            data = json.loads(line)
            raw_url = data.get("url", "")
            if not is_clean_url(raw_url):
                continue

            domain = raw_url.split('/')[2] if '://' in raw_url else raw_url
            title = data.get("title") or domain.replace("www.", "").capitalize()
            desc = f"Web resource from {domain}. Click to view original context."

            vector = model.encode(title + " " + desc).tolist()

            points.append({
                "id": idx,
                "vector": vector,
                "payload": {
                    "url": raw_url,
                    "title": title,
                    "description": desc,
                    "domain": domain,
                    "lang": "en"
                }
            })
            idx += 1
        except Exception:
            continue
except Exception as e:
    print(f"Errore download .com: {e}")

# Caricamento su Qdrant (gli italiani saranno salvati nei primi ID)
if points:
    print(f"Caricamento di {len(points)} punti (Italiani + Inglesi puliti) su Qdrant...")
    client.upsert(collection_name=collection_name, points=points)
    print("Indicizzazione completata con successo!")
else:
    print("Nessun punto valido trovato da caricare.")
