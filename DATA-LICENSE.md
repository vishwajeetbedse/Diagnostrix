# Data licensing

This repository has two kinds of content, under different terms.

| What | License |
|---|---|
| The project's own source code, documentation and curated demonstration data (`backend/data/formulary.json`) | [Apache License 2.0](LICENSE) |
| Data derived from **DDInter** | **DDInter's own terms**, not Apache 2.0 (see below) |
| Responses from openFDA and RxNorm, cached at runtime | Their providers' terms (see below) |

## DDInter

Diagnostix uses the [DDInter](https://ddinter.scbdd.com/) drug–drug interaction database. DDInter's website says it is free for **academic and non-commercial use only**. Read DDInter's current terms on its site before you use or redistribute the data; this file summarises them and does not replace them.

**The Apache 2.0 license in [LICENSE](LICENSE) covers this project's own source code. It does not cover DDInter-derived data, and it cannot grant rights to that data.**

### Where DDInter data appears

| Path | What it is | In the git repository? |
|---|---|---|
| `backend/data/ddinter.sqlite3` | Local SQLite copy of DDInter's interaction table. Built by `python -m backend.tools.import_ddinter` (run by `setup.sh`). | No. It is created on each machine at setup time and listed in `.gitignore`. |
| DDInter CSV files (`ddinter_downloads_code_*.csv`) | DDInter's published download files. The import tool downloads them into memory, or reads them from a folder you pass with `--from-dir`. | No. The tool does not save them into the repository. |
| `backend/tests/conftest.py` | Five hand-written rows in DDInter's CSV column format, used as test fixtures. These are synthetic, not an extract of the database. | Yes |

Any copy of `ddinter.sqlite3` or the CSVs, including one bundled with a fork, a release archive or a Docker image of this project, is still subject to DDInter's terms.

### Commercial or clinical use

If you want to use this project **commercially**, or in **any real clinical setting**, you must either:

1. independently confirm that you have the right to use DDInter's data for that purpose (for example by contacting the DDInter team), **or**
2. replace DDInter with an interaction dataset you are licensed to use. The importer (`backend/tools/import_ddinter.py`) and the lookup (`backend/app/sources/ddinter.py`) are small and isolated so that a different source can be swapped in.

The app runs without DDInter: interaction checks then use only the curated knowledge base. The System page shows "DDInter: not imported".

### Citation

If you use DDInter in academic work, cite the DDInter authors. DDInter's website lists its preferred citation. At the time of writing the original paper was:

> Xiong G, Yang Z, Yi J, et al. DDInter: an online drug–drug interaction database towards improving clinical decision-making and patient safety. *Nucleic Acids Research*. 2022;50(D1):D1200–D1207.

## openFDA and RxNorm

At runtime the app queries [openFDA](https://open.fda.gov/) (drug labels, FAERS adverse-event reports) and [RxNorm / RxNav](https://lhncbc.nlm.nih.gov/RxNav/) from the U.S. National Library of Medicine. Responses are cached in `backend/data/cache.sqlite3`, which is also git-ignored. Use of these services and their data is governed by their providers' terms of service:

- openFDA: <https://open.fda.gov/terms/>
- NLM RxNav APIs: <https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html>

## Curated formulary

`backend/data/formulary.json` (dose ceilings, age limits, interaction write-ups for 10 drugs) was written for this project and is covered by Apache 2.0. Its values are **for demonstration only**. They have not been clinically validated and must be checked by a licensed pharmacist against institutional references before any real use.
