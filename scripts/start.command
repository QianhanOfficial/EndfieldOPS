#!/bin/zsh
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
python3 - "$PWD" "${1:-}" <<'PY'
import fcntl, hashlib, json, os, pathlib, socket, subprocess, sys, time, urllib.request
root = pathlib.Path(sys.argv[1]).resolve()
should_open = sys.argv[2] != '--no-open'
if sys.version_info < (3, 9):
    raise SystemExit('需要 Python 3.9 或更新版本。')
if not (root / 'dist/index.html').is_file():
    raise SystemExit('请先在项目目录运行 npm install 和 npm run build。')
os.umask(0o077)
data = root / 'data'
data.mkdir(exist_ok=True)
lock = (data / 'service.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX)
pid_file = data / 'server.pid.json'
server_path = str(root / 'server/server.py')
# Keep the existing database filename to preserve personal records after the rename.
instance = hashlib.sha256(str((data / 'dayline.sqlite3').resolve()).encode('utf-8')).hexdigest()[:16]
def identity(pid):
    if type(pid) is not int or pid <= 1:
        return ''
    output = subprocess.run(['/bin/ps', '-ww', '-p', str(pid), '-o', 'lstart=', '-o', 'command='], text=True, capture_output=True, env={**os.environ, 'LC_ALL': 'en_US.UTF-8', 'TZ': 'UTC'}).stdout.strip()
    pieces = output.split(None, 5)
    if len(pieces) != 6 or not pieces[5].endswith(' ' + server_path):
        return ''
    # Apple's Python launcher execs a framework binary after Popen returns.
    # Start time and the exact script remain stable across that exec.
    return ' '.join(pieces[:5]) + '|' + server_path
def healthy():
    try:
        with urllib.request.urlopen('http://127.0.0.1:11325/api/health', timeout=0.6) as response:
            result = json.load(response)
        return result.get('ok') is True and result.get('instance') == instance
    except (OSError, ValueError):
        return False
if pid_file.exists():
    try:
        saved = json.loads(pid_file.read_text())
        current = identity(saved['pid'])
        if current and current == saved['identity'] and server_path in current:
            if not healthy():
                raise SystemExit('EOPS进程存在，但尚未通过健康检查。请查看 data/server.log，或停止后重新启动。')
            print('EOPS已在运行：http://127.0.0.1:11325')
            if should_open:
                subprocess.run(['/usr/bin/open', 'http://127.0.0.1:11325'])
            raise SystemExit(0)
    except (ValueError, KeyError, TypeError):
        pass
# Detect an existing unrelated listener before starting a second process.
probe = socket.socket()
probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    probe.bind(('127.0.0.1', 11325))
except OSError:
    raise SystemExit('11325 端口已被占用，未启动或停止任何其他服务。')
finally:
    probe.close()
log = (data / 'server.log').open('ab')
process = subprocess.Popen([sys.executable, server_path], cwd=root, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
# In a Chinese-named folder, ps must retain UTF-8 and return a nonempty identity.
record = {'pid': process.pid, 'identity': ''}
for _ in range(40):
    record['identity'] = identity(process.pid)
    if record['identity'] or process.poll() is not None:
        break
    time.sleep(0.025)
if not record['identity']:
    if process.poll() is None:
        process.terminate()
    raise SystemExit('无法确认新启动的 EOPS 进程身份，请查看 data/server.log。')
temporary_pid = pid_file.with_suffix('.tmp')
temporary_pid.write_text(json.dumps(record))
temporary_pid.replace(pid_file)
for _ in range(80):
    if process.poll() is not None:
        if pid_file.exists():
            pid_file.unlink()
        raise SystemExit('启动失败。可能 11325 端口已被占用；详情保存在 data/server.log。')
    try:
        if healthy() and identity(process.pid) == record['identity']:
            # Give a duplicate process time to fail if another service owns the port.
            time.sleep(0.25)
            if process.poll() is not None:
                continue
            print('EOPS已启动：http://127.0.0.1:11325')
            if should_open:
                subprocess.run(['/usr/bin/open', 'http://127.0.0.1:11325'])
            break
    except (OSError, ValueError):
        pass
    time.sleep(0.15)
else:
    print('启动尚未就绪，请查看 data/server.log。')
    raise SystemExit(1)
PY
