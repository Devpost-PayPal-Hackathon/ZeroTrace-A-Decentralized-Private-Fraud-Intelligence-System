# backend/database.py
# SQLite for local dev — zero install, single file at backend/zerotrace.db
# When you're ready for Postgres in prod, just swap the DATABASE_URL in .env
# ─────────────────────────────────────────────────────────────────────────────

import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# SQLite file lives at backend/zerotrace.db
_DB_PATH = os.path.join(os.path.dirname(__file__), "zerotrace.db")
DATABASE_URL = f"sqlite:///{_DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # required for SQLite + FastAPI
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()