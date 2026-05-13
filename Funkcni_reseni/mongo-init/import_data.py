import os
import json
import time
from pymongo import MongoClient, UpdateOne
from pymongo.errors import OperationFailure

# Připojovací URI k MongoDB.
# Pokud proměnná prostředí není nastavena, použije se výchozí připojení přes mongos.
MONGO_URI = os.environ.get(
    "MONGO_URI",
    "mongodb://admin:adminpass@mongos1:27017/admin?authSource=admin"
)

# Název cílové databáze.
DB_NAME = os.environ.get("DB_NAME", "steam_bd")

# Adresář, ve kterém jsou uloženy JSON soubory pro import.
DATA_DIR = os.environ.get("DATA_DIR", "/data")

# Seznam kolekcí a odpovídajících souborů.
FILES = [
    ("games", "games.json"),
    ("reviews", "reviews.json"),
    ("ranking", "ranking.json"),
]


def wait_for_mongo(client: MongoClient, timeout_sec: int = 600):
    """
    Čeká, dokud MongoDB nezačne odpovídat na ping.
    Pokud databáze není do stanoveného limitu dostupná, vyvolá chybu.
    """
    start = time.time()

    while True:
        try:
            if client.admin.command("ping").get("ok") == 1:
                print("MongoDB is ready")
                return
        except Exception as e:
            print("Waiting for MongoDB...", str(e))

        if time.time() - start > timeout_sec:
            raise RuntimeError("MongoDB not ready (ping timeout)")

        time.sleep(2)


def load_json_any(path: str):
    """
    Načte JSON soubor bez ohledu na to, zda je uložen:
    - jako JSON pole,
    - jako JSON Lines (jeden dokument na řádek),
    - nebo jako jeden samostatný JSON objekt.
    """
    with open(path, "r", encoding="utf-8") as f:
        first = f.read(1)
        f.seek(0)

        # Varianta 1: klasické JSON pole
        if first == "[":
            data = json.load(f)
            if not isinstance(data, list):
                raise ValueError(f"Expected JSON array in file: {path}")
            return data

        # Varianta 2: JSON Lines
        docs = []
        for line in f:
            line = line.strip()
            if not line:
                continue
            docs.append(json.loads(line))

        if docs:
            return docs

        # Varianta 3: jeden objekt nebo pole načtené standardním json.load()
        f.seek(0)
        data = json.load(f)

        if isinstance(data, dict):
            return [data]

        if isinstance(data, list):
            return data

        raise ValueError(f"Unsupported JSON structure in file: {path}")


def ensure_ids(docs, prefix):
    """
    Zajistí, aby měl každý dokument pole _id.
    Pokud _id chybí, vytvoří se automaticky z názvu kolekce a game_name_norm.
    """
    for i, d in enumerate(docs):
        if "_id" not in d:
            if "game_name_norm" in d and d["game_name_norm"]:
                d["_id"] = f"{prefix}:{d['game_name_norm']}:{i}"
            else:
                d["_id"] = f"{prefix}:{i}"
    return docs


def upsert_many(coll, docs, batch_size=1000):
    """
    Uloží dokumenty do kolekce po dávkách pomocí bulk upsert.
    Pokud dokument se stejným _id už existuje, bude aktualizován.
    Pokud neexistuje, bude vytvořen.
    """
    ops = []

    for d in docs:
        ops.append(UpdateOne({"_id": d["_id"]}, {"$set": d}, upsert=True))

        if len(ops) >= batch_size:
            coll.bulk_write(ops, ordered=False)
            ops = []

    if ops:
        coll.bulk_write(ops, ordered=False)


def validate_docs(coll_name, docs):
    """
    Provede základní kontrolu načtených dokumentů.
    Ověří, že kolekce není prázdná a že dokumenty obsahují game_name_norm.
    """
    if not docs:
        raise ValueError(f"No documents loaded for collection {coll_name}")

    missing = [i for i, d in enumerate(docs[:100]) if "game_name_norm" not in d]
    if missing:
        raise ValueError(
            f"Collection {coll_name} missing 'game_name_norm' in some documents"
        )


def apply_validation_schemas(db):
    """
    Nastaví validační schémata kolekcí pomocí $jsonSchema.
    Tím se omezí ukládání dokumentů s nesprávnou strukturou nebo typy polí.
    """
    print("Applying validation schemas...")

    schemas = {
        "games": {
            "$jsonSchema": {
                "bsonType": "object",
                "required": ["_id", "game_name_norm", "game_name"],
                "properties": {
                    "_id": {"bsonType": ["string", "objectId"]},
                    "game_name_norm": {"bsonType": "string"},
                    "game_name": {"bsonType": "string"},
                    "short_description": {"bsonType": ["string", "null"]},
                    "long_description": {"bsonType": ["string", "null"]},
                    "genres": {"bsonType": ["string", "null"]},
                    "genres_list": {
                        "bsonType": ["array", "null"],
                        "items": {"bsonType": "string"}
                    },
                    "developer": {"bsonType": ["string", "null"]},
                    "publisher": {"bsonType": ["string", "null"]},
                    "release_date": {"bsonType": ["string", "null"]},
                    "release_year": {"bsonType": ["int", "long", "double", "null"]},
                    "number_of_reviews_from_purchased_people": {
                        "bsonType": ["int", "long", "double", "null"]
                    },
                    "number_of_english_reviews": {
                        "bsonType": ["int", "long", "double", "null"]
                    },
                    "overall_player_rating": {"bsonType": ["string", "null"]},
                    "has_unknown_meta": {"bsonType": ["bool", "null"]}
                }
            }
        },
        "reviews": {
            "$jsonSchema": {
                "bsonType": "object",
                "required": ["_id", "game_name_norm", "game_name", "review"],
                "properties": {
                    "_id": {"bsonType": ["string", "objectId"]},
                    "game_name_norm": {"bsonType": "string"},
                    "game_name": {"bsonType": "string"},
                    "username": {"bsonType": ["string", "null"]},
                    "review": {"bsonType": "string"},
                    "recommendation": {"bsonType": ["string", "bool", "null"]},
                    "hours_played": {"bsonType": ["double", "int", "long", "decimal", "null"]},
                    "helpful": {"bsonType": ["double", "int", "long", "decimal", "null"]},
                    "funny": {"bsonType": ["double", "int", "long", "decimal", "null"]},
                    "review_date": {"bsonType": ["string", "null"]},
                    "review_year": {"bsonType": ["int", "long", "double", "null"]}
                }
            }
        },
        "ranking": {
            "$jsonSchema": {
                "bsonType": "object",
                "required": ["_id", "game_name_norm", "game_name", "rank_type", "rank"],
                "properties": {
                    "_id": {"bsonType": ["string", "objectId"]},
                    "game_name_norm": {"bsonType": "string"},
                    "game_name": {"bsonType": "string"},
                    "rank_type": {"bsonType": "string"},
                    "rank": {"bsonType": ["int", "long", "double", "decimal"]},
                    "genre": {"bsonType": ["string", "null"]}
                }
            }
        }
    }

    for coll_name, validator in schemas.items():
        try:
            db.command({
                "collMod": coll_name,
                "validator": validator,
                "validationLevel": "moderate",
                "validationAction": "error"
            })
            print(f"Validator applied: {coll_name}")
        except OperationFailure as e:
            raise RuntimeError(f"Failed to apply validator for {coll_name}: {e}")

    print("Validation schemas applied.")


def create_indexes(db):
    """
    Vytvoří indexy potřebné pro spojování kolekcí, filtrování,
    textové vyhledávání a optimalizaci analytických dotazů.
    """
    print("Creating indexes...")

    db.games.create_index(
        [("game_name_norm", 1)],
        name="idx_games_game_name_norm"
    )
    db.games.create_index(
        [("developer", 1)],
        name="idx_games_developer"
    )
    db.games.create_index(
        [("publisher", 1)],
        name="idx_games_publisher"
    )

    db.reviews.create_index(
        [("game_name_norm", 1)],
        name="idx_reviews_game_name_norm"
    )
    db.reviews.create_index(
        [("recommendation", 1)],
        name="idx_reviews_recommendation"
    )
    db.reviews.create_index(
        [("hours_played", 1)],
        name="idx_reviews_hours_played"
    )
    db.reviews.create_index(
        [("review_year", 1)],
        name="idx_reviews_review_year"
    )
    db.reviews.create_index(
        [("username", 1), ("game_name_norm", 1)],
        name="idx_reviews_username_game_name_norm"
    )
    db.reviews.create_index(
        [("review", "text")],
        name="idx_reviews_text"
    )
    db.reviews.create_index(
        [("recommendation", 1), ("game_name_norm", 1), ("helpful", -1)],
        name="idx_reviews_recommend_game_helpful"
    )

    db.ranking.create_index(
        [("game_name_norm", 1), ("rank_type", 1)],
        name="idx_ranking_game_name_norm_rank_type"
    )
    db.ranking.create_index(
        [("genre", 1)],
        name="idx_ranking_genre"
    )
    db.ranking.create_index(
        [("rank_type", 1)],
        name="idx_ranking_rank_type"
    )
    db.ranking.create_index(
        [("rank", 1)],
        name="idx_ranking_rank"
    )

    print("Indexes created.")


def main():
    """
    Hlavní vstupní bod skriptu:
    1. připojí se k MongoDB,
    2. počká na dostupnost databáze,
    3. smaže staré kolekce,
    4. naimportuje nové dokumenty,
    5. nastaví validační schémata,
    6. vytvoří indexy.
    """
    client = MongoClient(MONGO_URI)
    wait_for_mongo(client)

    db = client[DB_NAME]

    print("Cleaning old collections before import...")
    for coll_name, _ in FILES:
        db[coll_name].drop()
        print(f"Dropped: {DB_NAME}.{coll_name}")

    for coll_name, filename in FILES:
        path = os.path.join(DATA_DIR, filename)

        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")

        print(f"Importing {path} -> {DB_NAME}.{coll_name}")

        docs = load_json_any(path)
        validate_docs(coll_name, docs)
        docs = ensure_ids(docs, coll_name)
        upsert_many(db[coll_name], docs)

        print(f"Done: {coll_name}, documents: {len(docs)}")

    apply_validation_schemas(db)
    create_indexes(db)

    print("All imports done successfully.")


if __name__ == "__main__":
    main()