#!/usr/bin/env python3
"""Report local math toolchain availability as JSON. Missing engines are facts, not failures."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

IMPORTS = ("sympy", "numpy", "scipy", "matplotlib", "jax")
PATH_CMDS = (
    ("lean", ("lean",)),
    ("lake", ("lake",)),
    ("gp", ("gp.exe", "gp")),
    ("pari", ("pari.exe", "pari")),
)


def try_import(name: str) -> dict:
    try:
        module = __import__(name)
    except Exception as exc:  # noqa: BLE001 — doctor must never crash on a missing extra
        return {"available": False, "error": f"{type(exc).__name__}: {exc}"}
    version = getattr(module, "__version__", None)
    return {"available": True, "version": version}


def which(cmd: str) -> dict:
    path = shutil.which(cmd)
    if path and Path(path).name.lower() in {"gp.cmd", "gp.bat", "gp.ps1"}:
        return {"available": False, "path": None, "error": "PowerShell alias, not PARI/GP"}
    return {"available": bool(path), "path": path}


def which_any(cmds: tuple[str, ...]) -> dict:
    last = {"available": False, "path": None}
    for cmd in cmds:
        found = which(cmd)
        if found.get("available"):
            return found
        last = found
    extra = {
        "gp": (
            r"C:\Program Files\PARI\gp.exe",
            r"C:\Program Files (x86)\PARI\gp.exe",
            r"C:\Program Files\Pari64-2-17-0\gp.exe",
        ),
        "pari": (
            r"C:\Program Files\PARI\gp.exe",
            r"C:\Program Files (x86)\PARI\gp.exe",
        ),
        "lean": (
            str(Path.home() / ".elan" / "bin" / "lean.exe"),
        ),
        "lake": (
            str(Path.home() / ".elan" / "bin" / "lake.exe"),
        ),
    }
    key = cmds[0].split(".")[0].lower()
    for candidate in extra.get(key, ()):
        if Path(candidate).is_file():
            return {"available": True, "path": candidate}
    return last


def _gp_printed_one(stdout: str) -> bool:
    lines = [ln.strip() for ln in (stdout or "").splitlines() if ln.strip()]
    return lines[:1] == ["1"]


def probe_gp_invoke(path: str | None) -> dict:
    """Detect how to feed GP code. Windows gp.exe -c prints Usage and may exit 0."""
    empty = {"supports_c": False, "supports_stdin_f": False, "invoke": None}
    if not path:
        return empty
    combined_c = ""
    supports_c = False
    try:
        completed = subprocess.run(
            [path, "-q", "-c", "print(1); quit"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        combined_c = (completed.stdout or "") + (completed.stderr or "")
        if "Usage:" in combined_c or "Available options" in combined_c:
            supports_c = False
        else:
            supports_c = _gp_printed_one(completed.stdout or "")
    except Exception:  # noqa: BLE001 — probe must never crash the doctor
        supports_c = False
    supports_stdin = False
    try:
        completed = subprocess.run(
            [path, "-q", "-f"],
            input="print(1);\nquit\n",
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        combined_f = (completed.stdout or "") + (completed.stderr or "")
        if "Usage:" in combined_f or "Available options" in combined_f:
            supports_stdin = False
        else:
            supports_stdin = _gp_printed_one(completed.stdout or "")
    except Exception:  # noqa: BLE001
        supports_stdin = False
    if supports_c:
        invoke = f'"{path}" -q -c "<gp-code>"'
    elif supports_stdin:
        invoke = f'<gp-code> | "{path}" -q -f'
    else:
        invoke = None
    return {
        "supports_c": supports_c,
        "supports_stdin_f": supports_stdin,
        "invoke": invoke,
    }

Z3_INSTALL = Path(r"C:\Users\yuluk\Desktop\z3-5.3.1-x64-win")


def probe_z3() -> dict:
    """Local Z3. Category is an SMT solver, not a CAS and not Lean."""
    base = {
        "available": False,
        "path": None,
        "version": None,
        "category": "SMT",
        "category_name": "Satisfiability Modulo Theories",
        "role": "SMT solver",
        "invoke": None,
        "answers_check_sat": False,
        "python": None,
        "error": None,
    }
    candidates: list[Path] = []
    fixed = Z3_INSTALL / "bin" / "z3.exe"
    if fixed.is_file():
        candidates.append(fixed)
    for name in ("z3.exe", "z3"):
        found = shutil.which(name)
        if not found:
            continue
        path = Path(found)
        if path not in candidates:
            candidates.append(path)
    if not candidates:
        base["error"] = "z3.exe not found"
        return base
    exe = candidates[0]
    base["path"] = str(exe)
    try:
        completed = subprocess.run(
            [str(exe), "-version"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        text = ((completed.stdout or "") + "\n" + (completed.stderr or "")).strip()
    except Exception as exc:  # noqa: BLE001 — probe must never crash the doctor
        base["error"] = f"{type(exc).__name__}: {exc}"
        return base
    match = re.search(r"Z3 version (\S+)", text)
    if completed.returncode != 0 or not match:
        base["error"] = (text or f"exit {completed.returncode}")[:200]
        return base
    base["version"] = match.group(1)
    base["available"] = True
    base["invoke"] = f'"{exe}" -in'
    try:
        sat = subprocess.run(
            [str(exe), "-in"],
            input="(declare-const p Bool)\n(assert p)\n(check-sat)\n",
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        first = (sat.stdout or "").strip().splitlines()[:1]
        base["answers_check_sat"] = first == ["sat"]
    except Exception:  # noqa: BLE001
        base["answers_check_sat"] = False
    package = exe.parent / "python"
    library = exe.parent / "libz3.dll"
    if (package / "z3" / "__init__.py").is_file() and library.is_file():
        base["python"] = {
            "package": str(package),
            "library_dir": str(exe.parent),
            "before_import": (
                "Set PYTHONPATH to package and Z3_LIBRARY_PATH to library_dir, then import z3. "
                "libz3.dll sits in bin, not inside the package."
            ),
        }
    return base


def py_launcher_interpreters() -> list[str]:
    py = shutil.which("py")
    if not py:
        return []
    try:
        completed = subprocess.run(
            [py, "-0p"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except Exception:  # noqa: BLE001
        return []
    found = []
    for line in (completed.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        path = parts[-1]
        if Path(path).is_file():
            found.append(path)
    return found


def probe_interpreter(executable: str) -> dict:
    script = (
        "import importlib, json, sys\n"
        "mods = ['sympy', 'numpy', 'scipy', 'matplotlib', 'jax']\n"
        "out = {'executable': sys.executable, 'version': sys.version, 'imports': {}}\n"
        "for name in mods:\n"
        "    try:\n"
        "        mod = importlib.import_module(name)\n"
        "        out['imports'][name] = {'available': True, 'version': getattr(mod, '__version__', None)}\n"
        "    except Exception as exc:\n"
        "        out['imports'][name] = {'available': False, 'error': type(exc).__name__ + ': ' + str(exc)}\n"
        "print(json.dumps(out))\n"
    )
    try:
        completed = subprocess.run(
            [executable, "-c", script],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "executable": executable,
            "available": False,
            "error": f"{type(exc).__name__}: {exc}",
        }
    if completed.returncode != 0:
        err = (completed.stderr or completed.stdout or "").strip()[:400]
        return {
            "executable": executable,
            "available": False,
            "error": err or f"exit {completed.returncode}",
        }
    try:
        payload = json.loads(completed.stdout)
    except Exception as exc:  # noqa: BLE001
        return {
            "executable": executable,
            "available": False,
            "error": f"{type(exc).__name__}: {exc}",
        }
    payload["available"] = True
    return payload


def unique_executables() -> list[str]:
    ordered = [sys.executable]
    for extra in py_launcher_interpreters():
        ordered.append(extra)
    for name in ("python", "python3"):
        found = shutil.which(name)
        if found:
            ordered.append(found)
    unique = []
    seen = set()
    for item in ordered:
        try:
            key = str(Path(item).resolve()).lower()
        except Exception:  # noqa: BLE001
            key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def main() -> int:
    interpreters = [probe_interpreter(exe) for exe in unique_executables()]
    current_imports = {name: try_import(name) for name in IMPORTS}
    path_info = {name: which_any(cmds) for name, cmds in PATH_CMDS}
    for name in ("gp", "pari"):
        info = path_info[name]
        if info.get("available"):
            info.update(probe_gp_invoke(info.get("path")))
        else:
            info.update({"supports_c": False, "supports_stdin_f": False, "invoke": None})
    path_info["z3"] = probe_z3()
    notes: dict = {
        "missing_engines_are_facts": True,
        "gp_c_usage_exit0_is_not_success": True,
        "z3_category": "SMT solver (Satisfiability Modulo Theories)",
    }
    if os.name == "nt":
        notes["pwsh_alias_collisions"] = {
            "gp": "Get-ItemProperty - call gp.exe, never bare gp",
            "r": "Invoke-History - not R",
            "curl": "Invoke-WebRequest",
            "calc": "Windows calc.exe is GUI, not the calculator tool",
        }
    payload = {
        "python": {
            "version": sys.version,
            "executable": sys.executable,
        },
        "interpreters": interpreters,
        "imports": current_imports,
        "path": path_info,
        "notes": notes,
    }
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
