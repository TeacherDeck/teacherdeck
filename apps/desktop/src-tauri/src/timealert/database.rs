// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Exact Room DB7 validation and WAL-aware private snapshots.
use super::{internal, invalid, schema};
use deck_core::DeckError;
use rusqlite::{Connection, OpenFlags, limits::Limit};
use std::collections::BTreeSet;
use std::path::Path;

pub fn open(path: &Path) -> Result<Connection, DeckError> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| invalid())?;
    configure(&db)?;
    db.execute_batch(
        "PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;",
    )
    .map_err(|_| invalid())?;
    Ok(db)
}
fn configure(db: &Connection) -> Result<(), DeckError> {
    for (limit, value) in [
        (Limit::SQLITE_LIMIT_LENGTH, 16 * 1024 * 1024),
        (Limit::SQLITE_LIMIT_SQL_LENGTH, 1024 * 1024),
        (Limit::SQLITE_LIMIT_COLUMN, 512),
        (Limit::SQLITE_LIMIT_EXPR_DEPTH, 100),
        (Limit::SQLITE_LIMIT_ATTACHED, 0),
    ] {
        db.set_limit(limit, value).map_err(|_| invalid())?;
    }
    Ok(())
}
pub fn create(path: &Path) -> Result<Connection, DeckError> {
    if path.exists() {
        return Err(internal());
    }
    let db = Connection::open(path).map_err(|_| internal())?;
    for (_, sql) in schema::TABLES {
        db.execute_batch(sql).map_err(|_| internal())?;
    }
    for sql in schema::INDEXES {
        db.execute_batch(sql).map_err(|_| internal())?;
    }
    db.execute_batch("CREATE TABLE room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT); PRAGMA user_version=7;").map_err(|_| internal())?;
    db.execute(
        "INSERT INTO room_master_table VALUES(42,?1)",
        [schema::ROOM_HASH],
    )
    .map_err(|_| internal())?;
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;")
        .map_err(|_| internal())?;
    Ok(db)
}
type SchemaRows = Vec<Vec<Option<String>>>;
fn schema_rows(db: &Connection, sql: &str, key: &str) -> Result<SchemaRows, DeckError> {
    let mut statement = db.prepare(sql).map_err(|_| invalid())?;
    let width = statement.column_count();
    statement
        .query_map([key], |row| {
            (0..width)
                .map(|column| row.get(column))
                .collect::<Result<Vec<Option<String>>, _>>()
        })
        .map_err(|_| invalid())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid())
}
fn columns(db: &Connection, table: &str) -> Result<SchemaRows, DeckError> {
    // xinfo includes hidden/generated columns that table_info omits.
    schema_rows(
        db,
        "SELECT name,type,CAST(\"notnull\" AS TEXT),dflt_value,CAST(pk AS TEXT),CAST(hidden AS TEXT) FROM pragma_table_xinfo(?1) ORDER BY cid",
        table,
    )
}
fn foreign_keys(db: &Connection, table: &str) -> Result<SchemaRows, DeckError> {
    schema_rows(
        db,
        "SELECT CAST(seq AS TEXT),\"table\",\"from\",\"to\",on_update,on_delete,match FROM pragma_foreign_key_list(?1) ORDER BY \"table\",\"from\",\"to\",on_update,on_delete,match,seq",
        table,
    )
}
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct IndexSchema {
    name: String,
    unique: bool,
    origin: String,
    partial: bool,
    columns: SchemaRows,
}
fn indexes(db: &Connection, table: &str) -> Result<Vec<IndexSchema>, DeckError> {
    let mut statement = db
        .prepare("SELECT name,\"unique\",origin,partial FROM pragma_index_list(?1)")
        .map_err(|_| invalid())?;
    let rows = statement
        .query_map([table], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
            ))
        })
        .map_err(|_| invalid())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid())?;
    let mut result = Vec::new();
    for (name, unique, origin, partial) in rows {
        let columns = schema_rows(
            db,
            "SELECT CAST(cid AS TEXT),name,CAST(desc AS TEXT),coll,CAST(key AS TEXT) FROM pragma_index_xinfo(?1) ORDER BY seqno",
            &name,
        )?;
        // SQLite assigns automatic names; their constraints and ordered key columns are authoritative.
        let normalized = if origin == "pk" || origin == "u" {
            String::new()
        } else {
            name
        };
        result.push(IndexSchema {
            name: normalized,
            unique,
            origin,
            partial,
            columns,
        });
    }
    result.sort();
    Ok(result)
}
pub fn validate(db: &Connection) -> Result<(), DeckError> {
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| invalid())?;
    let integrity: String = db
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|_| invalid())?;
    if version != 7 || integrity != "ok" {
        return Err(invalid());
    }
    let hash: String = db
        .query_row(
            "SELECT identity_hash FROM room_master_table WHERE id=42",
            [],
            |row| row.get(0),
        )
        .map_err(|_| invalid())?;
    if hash != schema::ROOM_HASH {
        return Err(invalid());
    }
    let mut statement = db
        .prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
        .map_err(|_| invalid())?;
    let actual = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| invalid())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid())?;
    let expected: BTreeSet<_> = schema::TABLES
        .iter()
        .map(|(name, _)| *name)
        .chain(["room_master_table"])
        .collect();
    let tables: BTreeSet<_> = actual
        .iter()
        .filter(|(kind, _)| kind == "table")
        .map(|(_, name)| name.as_str())
        .collect();
    if tables != expected
        || actual
            .iter()
            .any(|(kind, _)| !["table", "index"].contains(&kind.as_str()))
    {
        return Err(invalid());
    }
    let template = Connection::open_in_memory().map_err(|_| internal())?;
    for (_, sql) in schema::TABLES {
        template.execute_batch(sql).map_err(|_| internal())?;
    }
    for sql in schema::INDEXES {
        template.execute_batch(sql).map_err(|_| internal())?;
    }
    template
        .execute_batch("CREATE TABLE room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)")
        .map_err(|_| internal())?;
    for name in &expected {
        if columns(db, name)? != columns(&template, name)?
            || foreign_keys(db, name)? != foreign_keys(&template, name)?
            || indexes(db, name)? != indexes(&template, name)?
        {
            return Err(invalid());
        }
    }
    let bad_fk: bool = db
        .prepare("PRAGMA foreign_key_check")
        .map_err(|_| invalid())?
        .exists([])
        .map_err(|_| invalid())?;
    if bad_fk {
        return Err(invalid());
    }
    Ok(())
}
pub fn snapshot(source: &Path, destination: &Path) -> Result<(), DeckError> {
    if destination.exists() {
        return Err(internal());
    }
    let db = Connection::open_with_flags(
        source,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| invalid())?;
    configure(&db)?;
    db.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=1000;")
        .map_err(|_| invalid())?;
    validate(&db)?;
    db.backup(rusqlite::MAIN_DB, destination, None)
        .map_err(|_| invalid())?;
    validate(&open(destination)?)
}
fn u32_at(bytes: &[u8], offset: usize, little: bool) -> Result<u32, DeckError> {
    let word: [u8; 4] = bytes
        .get(offset..offset + 4)
        .ok_or_else(invalid)?
        .try_into()
        .map_err(|_| invalid())?;
    Ok(if little {
        u32::from_le_bytes(word)
    } else {
        u32::from_be_bytes(word)
    })
}
fn checksum(bytes: &[u8], little: bool, mut sums: (u32, u32)) -> Result<(u32, u32), DeckError> {
    if !bytes.len().is_multiple_of(8) {
        return Err(invalid());
    }
    for pair in bytes.as_chunks::<8>().0 {
        sums.0 = sums
            .0
            .wrapping_add(u32_at(pair, 0, little)?)
            .wrapping_add(sums.1);
        sums.1 = sums
            .1
            .wrapping_add(u32_at(pair, 4, little)?)
            .wrapping_add(sums.0);
    }
    Ok(sums)
}
/// SQLite silently ignores malformed WAL; detect it before taking a snapshot.
pub fn validate_wal(path: &Path) -> Result<(), DeckError> {
    if !path.exists() {
        return Ok(());
    }
    let bytes = std::fs::read(path).map_err(|_| invalid())?;
    if bytes.len() < 32 || bytes.len() > super::archive::BACKUP_LIMIT {
        return Err(invalid());
    }
    let magic = u32_at(&bytes, 0, false)?;
    let little = match magic {
        0x377f0682 => true,
        0x377f0683 => false,
        _ => return Err(invalid()),
    };
    let page = u32_at(&bytes, 8, false)? as usize;
    if u32_at(&bytes, 4, false)? != 3_007_000
        || !(512..=65536).contains(&page)
        || !page.is_power_of_two()
        || !(bytes.len() - 32).is_multiple_of(page + 24)
    {
        return Err(invalid());
    }
    let mut sums = checksum(bytes.get(..24).ok_or_else(invalid)?, little, (0, 0))?;
    if sums != (u32_at(&bytes, 24, false)?, u32_at(&bytes, 28, false)?) {
        return Err(invalid());
    }
    let salt = bytes.get(16..24).ok_or_else(invalid)?;
    for frame in bytes.get(32..).ok_or_else(invalid)?.chunks_exact(page + 24) {
        // Reused WALs may have complete stale frames after the current salt epoch.
        // SQLite ignores that suffix; do not reject a valid current transaction.
        if frame.get(8..16).ok_or_else(invalid)? != salt {
            break;
        }
        if u32_at(frame, 0, false)? == 0 {
            return Err(invalid());
        }
        sums = checksum(frame.get(..8).ok_or_else(invalid)?, little, sums)?;
        sums = checksum(frame.get(24..).ok_or_else(invalid)?, little, sums)?;
        if sums != (u32_at(frame, 16, false)?, u32_at(frame, 20, false)?) {
            return Err(invalid());
        }
    }
    Ok(())
}
