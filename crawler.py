import os
import requests
import json
import re
from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer

QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")

if not QDRANT_URL or not QDRANT_API_KEY:
    raise ValueError("ERRORE: Secrets mancanti!")

client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
collection_name = "global_web"

# Reset collezione per rimuovere i vecchi dati spazzatura
try:
    client.delete_collection(collection_name=collection_name)
    print("Vecchia collezione eliminata con successo.")
except Exception:
    pass

client.create_collection(
    collection_name=collection_name,
    vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE)
)

model = SentenceTransformer('all-MiniLM-L6-v2')

ALLOWED_TLDS = ('.it', '.com', '.org', '.net', '.edu', '.eu', '.gov', '.io')

BLOCKED_PATTERNS = [
    r'netsoltrademark', r'__media__', r'robots\.txt', r'euro-shop', 
    r'checkmate', r'0-0-0', r'parking', r'redirect', r'\.php\?d=',
    r'slot', r'casino', r me'crypto', r'advert', r'click'
]

def is_valid_domain(domain):
    domain = domain.lower().strip()
    if not domain.endswith(ALLOWED_TLDS):
        return False
    if domain.count('-') > 2 or re.search(r'\d{4,}', domain):
        return False
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, domain):
            return False
    return True

SEED_DOMAINS_IT = [
    "https://www.ansa.it", "https://www.repubblica.it", "https://www.corriere.it",
    "https://www.ilsole24ore.com", "https://www.hwupgrade.it", "https://www.gazzetta.it",
    "https://www.geopop.it", "https://www.html.it", "https://www.aranzulla.it",
    "https://www.wikipedia.org", "https://it.wikipedia.org", "https://www.subito.it"
]

SEED_DOMAINS_EN = [
    "https://www.bbc.com", "https://www.github.com", "https://www.techcrunch.com",
    "https://www.theverge.com", "https://www.dev.to", "https://www.huggingface.co",
    "https://www.medium.com", "https://www.stackoverflow.com"
]

points = []
idx = 1

all_seeds = [(url, "it") for url in SEED_DOMAINS_IT] + [(url, "en") for url in SEED_DOMAINS_EN]

for raw_url, lang in all_seeds:
    domain = raw_url.split('/')[2]
    clean_title = domain.replace("www.", "").split('.')[0].capitalize()
    desc = f"Sito web verificato ({domain}) in lingua {lang}."

    vector = model.encode(clean_title + " " + desc).tolist()
    
    points.append({
        "id": idx,
        "vector": vector,
        "payload": {
            "url": raw_url,
            "title": f"{clean_title} - Home Page",
            "description": desc,
            "domain": domain,
            "lang": lang
        }
    })
    idx += 1

print("Recupero dati filtrati da Common Crawl...")
try:
    res = requests.get("https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*.it/*&output=json&limit=200", timeout=30)
    for line in res.text.strip().split('\n'):
        if not line or idx > 150:
            break
        try:
            data = json.loads(line)
            raw_url = data.get("url", "")
            domain = raw_url.split('/')[2] if '://' in raw_url else raw_url
            
            if is_valid_domain(domain):
                title = data.get("title") or domain.replace("www.", "").capitalize()
                desc = f"Risultato verificato da {domain}."
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
    print(f"Errore Common Crawl: {e}")

print(f"Caricamento di {len(points)} punti puliti su Qdrant...")
client.upsert(collection_name=collection_name, points=points)
print("Database ripopolato con successo!")
