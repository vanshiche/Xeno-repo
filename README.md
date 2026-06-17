# Xeno Implementation Internship Assignment

## DataVault — Transaction Validation Platform

A web-based platform for transaction data validation and processing, built for the Xeno Implementation Internship Assignment.

### Features
- **Drag & drop CSV upload** with real-time progress
- **Country-specific phone validation** — India (10-digit), Singapore (8-digit), US, UK, UAE, Australia, Germany, France, Japan, Multi-country
- **Date/time validation** — DD-MM-YYYY, YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY with calendar correctness checks
- **General data integrity checks** — email format, amount validation, quantity, payment mode, order/payment status, SKU
- **Duplicate row detection**
- **Blank row auto-filtering**
- **Dataset type auto-detection** — Customer / Transaction / Mixed
- **Column profiling** — fill rate, error rate, unique count per column
- **Error report download** — cleaned CSV + error rows CSV
- **CSV chunking** — split large files into configurable chunk sizes

### Files
| File | Purpose |
|------|---------|
| `index.html` | Main platform UI |
| `styles.css` | Apple-inspired dark design system |
| `app.js` | Main application controller |
| `validators.js` | Validation engine (phone, date, email, amount, etc.) |
| `processor.js` | CSV parser + chunking + download utilities |
| `sql_answers.md` | Parts 1–3 SQL answers |
| `TAM_INTERN_TABLE.csv` | Sample customer dataset |

### SQL Answers (Parts 1–3)
See [`sql_answers.md`](./sql_answers.md) for complete SQL queries covering:
- Part 1: Data familiarity & querying
- Part 2: Data transformation & enrichment
- Part 3: Analytics & reporting

### Tech Stack
- Pure HTML / CSS / JavaScript (no frameworks)
- FileReader API for client-side CSV processing
- Blob API for file downloads
- Apple HIG-inspired design system

### How to Run
Open `index.html` directly in any modern browser — no server required.
