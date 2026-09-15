import os
import requests
import json
from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer

# 1. Recupera le chiavi dalle impostazioni di GitHub
QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")

if not QDRANT_URL or not QDRANT_API_KEY:
    raise ValueError("ERRORE: QDRANT_URL o QDRANT_API_KEY non sono stati trovati nei Secrets di GitHub!")

print("Connessione a Qdrant Cloud in corso...")
client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

# 2. Verifica se la collezione 'global_web' esiste, altrimenti la crea
collection_name = "global_web"
collections = client.get_collections().collections
exists = any(c.name == collection_name for c in collections)

if not exists:
    print(f"La collezione '{collection_name}' non esiste. Creazione in corso...")
    client.create_collection(
        collection_name=collection_name,
        vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE)
    )

print("Caricamento del modello per gli embeddings...")
model = SentenceTransformer('all-MiniLM-L6-v2')

# 3. Legge i dati da Common Crawl
print("Recupero dati da Common Crawl...")
index_url = "https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*.org&output=json&limit=50"
res = requests.get(index_url)

if res.status_code != 200:
    raise Exception(f"Errore durante la richiesta a Common Crawl: status code {res.status_code}")

points = []
idx = 1

for line in res.text.strip().split('\n'):
    if not line:
        continue
    data = json.loads(line)
    url = data.get("url")
    title = data.get("title", url)
    
    vector = model.encode(title).tolist()
    points.append({
        "id": idx,
        "vector": vector,
        "payload": {"url": url, "title": title}
    })
    idx += 1

# 4. Invia i vettori a Qdrant Cloud
print(f"Invio di {len(points)} punti a Qdrant...")
client.upsert(collection_name=collection_name, points=points)
print("Operazione completata con successo!")
