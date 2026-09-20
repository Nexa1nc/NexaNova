import os
import requests
import json
from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer

QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")

if not QDRANT_URL or not QDRANT_API_KEY:
    raise ValueError("ERRORE: Secrets non trovati!")

client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
collection_name = "global_web"

# Ricrea/Assicura collezione
try:
    collections = client.get_collections().collections
    if not any(c.name == collection_name for c in collections):
        client.create_collection(
            collection_name=collection_name,
            vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE)
        )
except Exception as e:
    print(f"Errore collezione: {e}")

model = SentenceTransformer('all-MiniLM-L6-v2')

# Scarichiamo un campione di siti con metadati più ricchi
print("Fetching dati da Common Crawl / Open Web...")
index_url = "https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*.com&output=json&limit=150"
res = requests.get(index_url)

points = []
idx = 1

for line in res.text.strip().split('\n'):
    if not line:
        continue
    try:
        data = json.loads(line)
        raw_url = data.get("url", "")
        
        # Pulizia titolo e derivazione descrizione dal path/URL se il titolo manca
        domain = raw_url.split('/')[2] if '://' in raw_url else raw_url
        clean_title = data.get("title") or domain.replace("www.", "").capitalize()
        description = f"Risultato web indicizzato da {domain}. Clicca per visitare la pagina originale."

        vector = model.encode(clean_title + " " + description).tolist()
        
        points.append({
            "id": idx,
            "vector": vector,
            "payload": {
                "url": raw_url,
                "title": clean_title,
                "description": description,
                "domain": domain
            }
        })
        idx += 1
    except Exception:
        continue

print(f"Caricamento di {len(points)} punti su Qdrant...")
client.upsert(collection_name=collection_name, points=points)
print("Completato!")
