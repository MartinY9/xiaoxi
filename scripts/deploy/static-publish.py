"""Run through SSH stdin on Ubuntu; never installs or changes web services."""
import hashlib
import json
import os
import re
import shutil
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_manifest(manifest):
    files = manifest.get('files', {})
    if not files or 'index.html' not in files:
        raise ValueError('Missing index.html')
    for name, meta in files.items():
        if name != 'index.html' and not re.fullmatch(r'evidence/[A-Za-z0-9_.-]+\.jpg', name):
            raise ValueError('Unexpected public file: ' + name)
        if not re.fullmatch(r'[a-f0-9]{64}', meta.get('sha256', '')):
            raise ValueError('Invalid SHA-256')
        if not isinstance(meta.get('bytes'), int) or meta['bytes'] <= 0:
            raise ValueError('Invalid size')
    return files


def root_directory(raw, initialize=False):
    raw_path = Path(raw)
    if not raw_path.is_absolute() or len(raw_path.parts) < 3 or '..' in raw_path.parts:
        raise ValueError('A dedicated absolute application directory is required')
    # Reject symlinks in every existing component, including a symlinked parent.
    for candidate in [raw_path, *raw_path.parents]:
        if candidate.is_symlink():
            raise ValueError('Symlinked deployment directory is not supported')
    root = raw_path.resolve()
    marker = root / '.xiaoxi-static-site'
    if marker.is_symlink():
        raise ValueError('Symlinked application marker')
    if initialize:
        if root.exists() and not marker.is_file() and any(root.iterdir()):
            raise ValueError('Existing nonempty directory has no Xiaoxi marker; refusing to use it')
        root.mkdir(parents=True, exist_ok=True)
        if not marker.exists():
            marker.write_text('xiaoxi-static-v1\n', encoding='utf-8')
        root.chmod(0o755)
    if not marker.is_file() or marker.read_text('utf-8') != 'xiaoxi-static-v1\n':
        raise ValueError('Not an initialized Xiaoxi static directory')
    for name in ['site', 'site/evidence', 'incoming', 'releases']:
        p = root / name
        if p.is_symlink():
            raise ValueError('Symlinked application subdirectory is not supported')
        if initialize:
            p.mkdir(exist_ok=True)
            if name.startswith('site'):
                p.chmod(0o755)
    return root


def verify_file(path, meta):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Missing or symlinked file: ' + str(path))
    if path.stat().st_size != meta['bytes'] or digest(path) != meta['sha256']:
        raise ValueError('File integrity mismatch: ' + path.name)


def run(params):
    mode = params['mode']
    if mode not in ['plan', 'activate']:
        raise ValueError('Unknown operation')
    manifest = params['manifest']
    files = checked_manifest(manifest)
    release = manifest.get('release', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', release):
        raise ValueError('Invalid release ID')
    root = root_directory(params['remoteBase'], initialize=(mode == 'plan'))
    site, stage = root / 'site', root / 'incoming' / release
    if stage.is_symlink() or (stage / 'evidence').is_symlink():
        raise ValueError('Symlinked upload staging directory')
    if mode == 'plan':
        missing = []
        for name, meta in files.items():
            if name == 'index.html':
                continue
            p = site / name
            if p.exists() or p.is_symlink():
                verify_file(p, meta)
            else:
                missing.append(name)
        stage.mkdir(exist_ok=True)
        (stage / 'evidence').mkdir(exist_ok=True)
        print(json.dumps({'missing': missing, 'stage': str(stage), 'site': str(site)}))
        return
    lock = root / '.publish-lock'
    lock.mkdir()  # Concurrent activation fails rather than mixing releases.
    try:
        # Validate everything before changing the publicly served index.
        verify_file(stage / 'index.html', files['index.html'])
        for name, meta in files.items():
            if name == 'index.html':
                continue
            target = site / name
            verify_file(target if target.exists() else stage / name, meta)
        archive = root / 'releases' / release
        archive.mkdir(exist_ok=False)
        shutil.copyfile(stage / 'index.html', archive / 'index.html')
        (archive / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), 'utf-8')
        for name, meta in files.items():
            if name == 'index.html':
                continue
            target = site / name
            if target.exists():
                verify_file(target, meta)
            else:
                os.replace(stage / name, target)
                target.chmod(0o644)
        (stage / 'index.html').chmod(0o644)
        os.replace(stage / 'index.html', site / 'index.html')
        print(json.dumps({'activated': release, 'files': len(files), 'site': str(site)}))
    finally:
        lock.rmdir()
