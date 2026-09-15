import os
import requests
import json
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer

# Prendi le chiavi segrete che abbiamo salvato nei Secrets di GitHub
QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")

# Connettiti a Qdrant Cloud
client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
model = SentenceTransformer('all-MiniLM-L6-v2')

# Leggi gli ultimi siti da Common Crawl
index_url = "https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*.org&output=json&limit=50"
res = requests.get(index_url)

points = []
idx = 1

for line in res.text.strip().split('\n'):
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

# Invia i dati al tuo database nel cloud
client.upsert(collection_name="global_web", points=points)
print("Aggiornamento completato con successo!")
