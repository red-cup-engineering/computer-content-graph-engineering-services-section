---
id: spec.schema
title: RSC Schema Specification v0.1
status: active
document_type: specification
topics:
  - schema
  - graph
---
## Overview

This document specifies the schema for the Relational Source Control (RSC) system - Phase 1.

The RSC system transforms Git repositories into queryable relational graphs where:
- **Files are nodes** (RelCells) identified by (branch, commit, path)
- **Relationships are edges** with complete provenance
- **Knowledge is extracted** both from file content (endogenous) and Git/filesystem (exogenous)
- **Reconstruction is deterministic**: wiping and re-ingesting produces an identical database

## Core Data Model

### RelCell

A RelCell represents a file at a specific point in Git history.

**Identity**: `(branch, commit, path)` - uniquely identifies a file

**Types**:
- **File RelCells**: Actual files in the repository
- **Virtual RelCells**: Extracted entities (terms, authors) not backed by files but reconstructible from file content

```python
@dataclass(frozen=True)
class RelCell:
    branch: str              # Git branch name
    commit: str              # Full Git commit SHA
    path: str                # File path (or virtual identifier)
    file_type: Optional[str] # Extension: 'md', 'py', etc.
    is_virtual: bool         # True for non-file cells
```

**Examples**:
- File: `(branch="refactor/2025-11", commit="f5ada93...", path="research/discipline/mathematics/relationing/category-theory/proposing-relationing/papers/proposing-relationing.md")`
- Term: `(branch="refactor/2025-11", commit="f5ada93...", path="virtual:term.differentiation", is_virtual=True)`
- Author: `(branch="refactor/2025-11", commit="f5ada93...", path="virtual:author.emsenn", is_virtual=True)`
- Publication: `(branch="refactor/2025-11", commit="f5ada93...", path="virtual:publication.christiano2017", is_virtual=True)`

### Virtual Cell Conventions

Virtual cells use standardized path prefixes for consistency and deterministic reconstruction:

| Type | Prefix | Example | Extracted From |
|------|--------|---------|----------------|
| Term | `virtual:term.` | `virtual:term.differentiation` | Document frontmatter `[[defines]]` blocks |
| Author | `virtual:author.` | `virtual:author.emsenn` | Document frontmatter `authors` field |
| Publication | `virtual:publication.` | `virtual:publication.christiano2017` | Document frontmatter `[[cites_external]]` blocks |

**Author ID Normalization**: Author names are normalized to create consistent IDs:
- Lowercase: "emsenn" → "emsenn"
- Spaces to hyphens: "Vine Deloria Jr." → "vine-deloria-jr"
- Dots to hyphens: "Paul F. Christiano" → "paul-f-christiano"

This ensures the same author name always produces the same virtual RelCell ID.

### Edge

An edge represents a relationship between two RelCells (or RelCell and literal value).

```python
@dataclass
class Edge:
    subject: RelCell                  # Source RelCell
    predicate: str                    # Relationship type
    object_relcell: Optional[RelCell] # Target RelCell (if applicable)
    object_literal: Optional[Any]     # Literal value (if applicable)
    provenance: Provenance            # Complete audit trail
```

**Constraint**: Exactly one of `object_relcell` or `object_literal` must be set.

**Examples**:
```python
# Document defines a term
Edge(
    subject=RelCell(..., path="proposing-relationing.md"),
    predicate="defines",
    object_relcell=RelCell(..., path="virtual:term.differentiation"),
    provenance=Provenance(...)
)

# Document has an author
Edge(
    subject=RelCell(..., path="proposing-relationing.md"),
    predicate="author",
    object_relcell=RelCell(..., path="virtual:author.emsenn", is_virtual=True),
    provenance=Provenance(...)
)

# Author has a display name
Edge(
    subject=RelCell(..., path="virtual:author.emsenn", is_virtual=True),
    predicate="has_name",
    object_literal="emsenn",
    provenance=Provenance(...)
)

# Internal citation
Edge(
    subject=RelCell(..., path="describing-stability-optimization.md"),
    predicate="cites",
    object_relcell=RelCell(..., path="proposing-relationing.md"),
    provenance=Provenance(...)
)
```

### Provenance

Every edge must have complete provenance showing where and how it was extracted.

```python
@dataclass(frozen=True)
class Provenance:
    branch: str             # Git branch where extraction occurred
    commit: str             # Git commit SHA
    source_path: str        # File where claim originated
    span: Optional[Span]    # Location within file
    ingestor: str           # Extraction method identifier
    ingestor_version: str   # Version of extractor
    extracted_at: datetime  # Timestamp
```

**Span Types**:
- `line`: Line numbers (e.g., lines 15-42)
- `byte`: Byte offsets
- `frontmatter`: TOML frontmatter field (e.g., `frontmatter.cites_internal[2]`)
- `entire_file`: Whole file metadata (e.g., Git commit info)

**Ingestor Names** (standardized):
- `endogenous.markdown.frontmatter` - Extracted from Markdown TOML frontmatter
- `endogenous.python.imports` - Extracted from Python import statements
- `endogenous.python.decorators` - Extracted from Python decorators
- `exogenous.git.authorship` - Extracted from Git commit metadata
- `exogenous.filesystem.metadata` - Extracted from filesystem (MIME type, size)

## Markdown Frontmatter Schema

Documents use TOML frontmatter for metadata:

```toml
+++
# === IDENTITY ===
id = "proposing-relationing"  # Semantic ID (lowercase, hyphens, dots)
title = "Proposing Relationing"
aliases = ["Alternative Name"]

# === AUTHORIAL ===
authors = ["emsenn"]
date_created = "2025-11-08"
date_modified = "2025-11-08"
status = "canonical"  # draft | working | canonical | archived | deprecated

# === CLASSIFICATION ===
document_type = "foundational_treatise"
topics = ["relationing", "category-theory"]
disciplines = ["mathematics", "philosophy"]

# === CITATIONS - INTERNAL ===
cites_internal = ["other-doc-id"]
cited_by_internal = []  # Auto-populated

# === CITATIONS - EXTERNAL ===
[[cites_external]]
key = "christiano2017"
authors = ["Christiano, Paul F.", "et al."]
title = "Deep reinforcement learning from human preferences"
year = 2017

# === RELATIONAL ===
# Terms defined in this document
# Note: id should NOT include "term." prefix - ingestor adds "virtual:term."
[[defines]]
id = "differentiation"
label = "Differentiation"
description = "The primitive act of being; a minimal operation that distinguishes one region of possibility from another"

depends_on = ["category-theory"]

# === PUBLICATION ===
published = false

# === ADMINISTRATIVE ===
license = "MIT"
keywords = ["relationing"]

# === GIT CONTEXT ===
git_repo = "https://github.com/emsenn/research"
git_branch = "refactor/2025-11"
git_commit = "f5ada938cfa733d4c131f4fd8bf6bf353d4b1b31"
+++
```

## Validation Rules

### ID Format

Document IDs must match pattern: `^[a-z0-9\-\.]+$`

- Lowercase letters and numbers only
- Hyphens for word separation
- Dots for namespacing (e.g., `txt.relations.proposing-relationing`)
- Must be unique across the corpus

**Validation**: Python checks uniqueness at ingest time.

### Status Values

Valid statuses (from `DocumentStatus` enum):
- `draft` - Work in progress
- `working` - Active development
- `canonical` - Foundational, stable
- `archived` - Historical, no longer active
- `deprecated` - Superseded by another document

### Document Types

Valid types (from `DocumentType` enum):
- `foundational_treatise` - Major foundational work
- `paper` - Research paper
- `theorem` - Formal theorem statement
- `proof` - Mathematical proof
- `experiment` - Experimental work
- `note` - Working note
- `commentary` - Commentary on other work
- `synthesis` - Synthesis of multiple sources

### Citation Format

**Internal citations** use document IDs:
```toml
cites_internal = ["proposing-relationing", "foundations-of-relation"]
```

**Inline citations** in Markdown body use square bracket notation:
```markdown
This builds on previous work [@proposing-relationing; @foundations-of-relation].
```

**External citations** provide full bibliographic info:
```toml
[[cites_external]]
key = "deloria1999"
authors = ["Vine Deloria Jr."]
title = "Spirit and Reason"
year = 1999
venue = "Fulcrum Publishing"
```

## Predicate Registry

### Core Predicates

#### Authorial Category
- `author` - Person who authored document (RelCell → RelCell[author virtual])
- `has_name` - Display name for entity (RelCell → Literal[str])
- `created_on` - Creation date (RelCell → Literal[date])
- `modified_on` - Modification date (RelCell → Literal[date])
- `has_status` - Editorial status (RelCell → Literal[DocumentStatus])
- `has_title` - Document title (RelCell → Literal[str])
- `has_alias` - Alternative name (RelCell → Literal[str])

#### Topical Category
- `has_topic` - Subject area (RelCell → Literal[str] | Term)
- `has_discipline` - Academic discipline (RelCell → Literal[str])
- `has_keyword` - Indexing keyword (RelCell → Literal[str])
- `has_document_type` - Type classification (RelCell → Literal[DocumentType])

#### Citational Category
- `cites` - References internal document (RelCell → RelCell) [inverse: `cited_by`]
- `cited_by` - Referenced by internal document (RelCell → RelCell) [inverse: `cites`]
- `cites_external` - References external publication (RelCell → Literal[ExternalCitation])

#### Relational Category
- `defines` - Defines a term/concept (RelCell → Term)
- `depends_on` - Requires understanding of concept (RelCell → Term | Literal[str])
- `builds_on` - Extends another document (RelCell → RelCell)

#### Git Category (Exogenous)
- `committed_by` - Git author (RelCell → Literal[str])
- `committed_at` - Commit timestamp (RelCell → Literal[datetime])
- `git_commit_sha` - Full commit hash (RelCell → Literal[str])
- `git_branch` - Branch name (RelCell → Literal[str])
- `renamed_from` - Previous file path (RelCell → Literal[str])

#### Filesystem Category (Exogenous)
- `has_mime_type` - MIME type (RelCell → Literal[str])
- `has_size` - File size in bytes (RelCell → Literal[int])
- `has_checksum` - SHA-256 checksum (RelCell → Literal[str])

#### Code Category (Endogenous)
- `imports` - Python import (RelCell → RelCell | Literal[str])
- `decorated_with` - Python decorator (RelCell → Literal[str])

### Extensibility

New predicates can be added. When encountered, they're stored with:
- `is_core = False`
- Category inferred or marked as "custom"
- Full documentation encouraged

## SQLite Database Schema

### Core Tables

#### `relcells`
```sql
CREATE TABLE relcells (
    id INTEGER PRIMARY KEY,
    branch TEXT NOT NULL,
    commit TEXT NOT NULL,
    path TEXT NOT NULL,
    file_type TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    checksum TEXT,
    is_virtual BOOLEAN DEFAULT 0,
    ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(branch, commit, path)
);
```

#### `edges`
```sql
CREATE TABLE edges (
    id INTEGER PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES relcells(id),
    predicate TEXT NOT NULL,
    object_id INTEGER REFERENCES relcells(id),
    object_literal TEXT,
    provenance_id INTEGER NOT NULL REFERENCES provenance(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (object_id IS NOT NULL AND object_literal IS NULL) OR
        (object_id IS NULL AND object_literal IS NOT NULL)
    )
);
```

#### `provenance`
```sql
CREATE TABLE provenance (
    id INTEGER PRIMARY KEY,
    branch TEXT NOT NULL,
    commit TEXT NOT NULL,
    source_path TEXT NOT NULL,
    span_type TEXT,
    span_start INTEGER,
    span_end INTEGER,
    span_context TEXT,
    ingestor TEXT NOT NULL,
    ingestor_version TEXT NOT NULL,
    extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `terms`
```sql
CREATE TABLE terms (
    id INTEGER PRIMARY KEY,
    relcell_id INTEGER UNIQUE NOT NULL REFERENCES relcells(id),
    term_id TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    aliases TEXT,
    introduced_in INTEGER REFERENCES relcells(id)
);
```

**Note**: `relcell_id` links to a virtual RelCell representing this term.

#### `authors`
```sql
CREATE TABLE authors (
    id INTEGER PRIMARY KEY,
    relcell_id INTEGER UNIQUE NOT NULL REFERENCES relcells(id),
    author_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    aliases TEXT
);
```

**Note**: `relcell_id` links to a virtual RelCell representing this author.

#### `publications`
```sql
CREATE TABLE publications (
    id INTEGER PRIMARY KEY,
    relcell_id INTEGER UNIQUE NOT NULL REFERENCES relcells(id),
    citation_key TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    authors_json TEXT,
    year INTEGER,
    venue TEXT,
    doi TEXT,
    url TEXT,
    extra_json TEXT
);
```

**Note**: `relcell_id` links to a virtual RelCell representing this publication.

#### `document_metadata`
Denormalized cache for performance:
```sql
CREATE TABLE document_metadata (
    relcell_id INTEGER PRIMARY KEY REFERENCES relcells(id),
    doc_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    status TEXT,
    document_type TEXT,
    authors TEXT,  -- JSON array
    date_created TEXT,
    date_modified TEXT,
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Views

#### `v_internal_citations`
All internal citations with provenance:
```sql
SELECT 
    s.path as source_path,
    sd.title as source_title,
    e.predicate,
    t.path as target_path,
    td.title as target_title,
    p.span_type, p.span_start, p.span_end
FROM edges e
JOIN relcells s ON e.subject_id = s.id
JOIN relcells t ON e.object_id = t.id
LEFT JOIN document_metadata sd ON s.id = sd.relcell_id
LEFT JOIN document_metadata td ON t.id = td.relcell_id
LEFT JOIN provenance p ON e.provenance_id = p.id
WHERE e.predicate IN ('cites', 'cited_by', 'builds_on');
```

#### `v_document_catalog`
Catalog of all documents with metadata.

#### `v_term_definitions`
All terms with their definitions and source documents.

## Reconstruction Guarantee

**Principle**: If the database is wiped, re-ingesting the same Git commit must produce an identical database.

**Implications**:
1. Virtual cells must be deterministically extractable from file content
2. Provenance must capture exact source locations
3. No manual database edits without corresponding file changes
4. Ingestor versions must be recorded for reproducibility

**Examples**:
1. **Term**: `virtual:term.differentiation` is extracted from `proposing-relationing.md` frontmatter `[[defines]]` block
   - Re-ingesting the document recreates the term virtual RelCell and all its edges

2. **Author**: `virtual:author.emsenn` is extracted from `proposing-relationing.md` frontmatter `authors = ["emsenn"]`
   - Normalization ensures "emsenn" always produces the same author ID
   - Re-ingesting creates the author virtual RelCell and edge: `proposing-relationing.md --[author]--> virtual:author.emsenn`

3. **Publication**: `virtual:publication.christiano2017` is extracted from `[[cites_external]]` block
   - Re-ingesting recreates the publication virtual RelCell with all bibliographic metadata

**Workflow**:
```
Document ingestion
  ↓
Extract frontmatter.authors = ["emsenn"]
  ↓
Create virtual RelCell: virtual:author.emsenn
  ↓
Insert into authors table with relcell_id
  ↓
Create edge: document --[author]--> virtual:author.emsenn
  ↓
Create edge: virtual:author.emsenn --[has_name]--> "emsenn"
```

## Phase 1 Scope

Phase 1 delivers:
1. ✅ Complete schema specification (this document)
2. ✅ Python data models with validation
3. ✅ SQLite database schema
4. ✅ Predicate registry
5. ✅ Example frontmatter for foundational document
6. ⏳ TOML frontmatter parser and validator (Phase 2)
7. ⏳ Ingestors for Markdown and Git (Phase 2)
8. ⏳ Query interface (Phase 2+)

## Future Considerations

### RDF Export
SQLite is primary storage. RDF/SPARQL export will be generated on-demand for interoperability.

### Web Interface
Long-term goal: CMS/IDE for managing the repository through the RSC system.

### Branch Operations
Future support for:
- Querying across branches
- Projections (materialized subgraphs)
- Merge reconciliation

## References

- See `examples/proposing-relationing-frontmatter.toml` for complete frontmatter example
- See `rrpr/` package for Python implementation
- See parent specification: `attached_assets/Roadmap-RSC.txt`
