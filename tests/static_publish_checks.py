import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
from pathlib import Path

workspace = Path(__file__).resolve().parent.parent
(workspace / 'work').mkdir(exist_ok=True)
spec = importlib.util.spec_from_file_location('xiaoxi_publish', workspace / 'scripts' / 'deploy' / 'static-publish.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
html, jpg = b'<html>new</html>', b'\xff\xd8sample-real-bytes-for-transfer-test\xff\xd9'
meta = lambda b: {'sha256': hashlib.sha256(b).hexdigest(), 'bytes': len(b)}
manifest = {'release': 'test-release-001', 'files': {'index.html': meta(html), 'evidence/a.jpg': meta(jpg)}}
checks = []
def call(mode, root, data=manifest):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        app.run({'mode': mode, 'remoteBase': str(root), 'manifest': data})
    return json.loads(out.getvalue())
def fails(fn):
    try: fn()
    except (ValueError, FileExistsError): return
    raise AssertionError('Expected rejection')
with tempfile.TemporaryDirectory(prefix='xiaoxi-publish-', dir=workspace / 'work') as temp:
    base = Path(temp) / 'application'
    plan = call('plan', base)
    assert plan['missing'] == ['evidence/a.jpg']
    checks.append('first-deployment-missing-assets')
    stage = Path(plan['stage'])
    (base / 'site' / 'index.html').write_bytes(b'old-index')
    (stage / 'index.html').write_bytes(html)
    (stage / 'evidence' / 'a.jpg').write_bytes(b'corrupt')
    fails(lambda: call('activate', base))
    assert (base / 'site' / 'index.html').read_bytes() == b'old-index'
    assert not (base / 'site' / 'evidence' / 'a.jpg').exists()
    checks.append('corrupt-upload-preserves-public-index')
    (stage / 'evidence' / 'a.jpg').write_bytes(jpg)
    result = call('activate', base)
    assert result['files'] == 2
    assert (base / 'site' / 'index.html').read_bytes() == html
    assert (base / 'releases' / manifest['release'] / 'index.html').read_bytes() == html
    checks.append('verified-activation-and-version-copy')
    new = {**manifest, 'release': 'test-release-002'}
    assert call('plan', base, new)['missing'] == []
    checks.append('unchanged-assets-not-uploaded')
    (base / 'site' / 'evidence' / 'a.jpg').write_bytes(b'altered-on-server')
    fails(lambda: call('plan', base, new))
    checks.append('changed-server-evidence-rejected')
    foreign = Path(temp) / 'existing-project'
    foreign.mkdir()
    (foreign / 'existing.txt').write_text('existing', 'utf-8')
    fails(lambda: call('plan', foreign))
    assert not (foreign / '.xiaoxi-static-site').exists()
    checks.append('existing-unrelated-directory-preserved')
    malicious = {'release': 'test-release-003', 'files': {'index.html': meta(html), '../work/private.json': meta(b'private')}}
    fails(lambda: call('plan', Path(temp) / 'traversal', malicious))
    assert not (Path(temp) / 'traversal').exists()
    checks.append('non-public-path-rejected-before-mutation')
    lockbase = Path(temp) / 'locked'
    p = call('plan', lockbase)
    (Path(p['stage']) / 'index.html').write_bytes(html)
    (Path(p['stage']) / 'evidence' / 'a.jpg').write_bytes(jpg)
    (lockbase / '.publish-lock').mkdir()
    fails(lambda: call('activate', lockbase))
    assert not (lockbase / 'site' / 'index.html').exists()
    checks.append('concurrent-activation-rejected')
out = {'checks': checks, 'passed': len(checks), 'remoteSSHTested': False, 'serverModified': False}

print(json.dumps(out))
