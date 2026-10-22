#!/usr/bin/env python3
"""Package tracked source and the built frontend, excluding personal local data."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description='Build an EOPS macOS release ZIP')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'work' / 'release')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    if not (ROOT / 'dist' / 'index.html').is_file():
        parser.error('Run npm ci and npm run build before packaging.')
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    sources = [Path(name) for name in tracked if name and (ROOT / name).is_file()]
    forbidden = {'data', 'backups', 'work', 'node_modules', '.git'}
    for relative in sources:
        if relative.parts[0] in forbidden or relative.name.startswith('.env') or relative.suffix in {'.sqlite3', '.log', '.pyc'}:
            parser.error(f'Local-only file is tracked: {relative}')
    sources.extend(p.relative_to(ROOT) for p in (ROOT / 'dist').rglob('*') if p.is_file())
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    stem = f'EndfieldOPS-{version}-macOS'
    target = output / (stem + '.zip')
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in sorted(set(sources)):
            archive.write(ROOT / relative, f'{stem}/{relative.as_posix()}')
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    checksums = output / 'SHA256SUMS.txt'
    checksums.write_text(f'{digest}  {target.name}\n')
    print(target)
    print(checksums)


if __name__ == '__main__':
    main()
