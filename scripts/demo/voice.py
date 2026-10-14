"""Generate cached natural neural narration from docs/demo/video-script.md.
Install edge-tts in a temporary virtual environment. No API key required.
Only the public demo narration text is submitted to the speech service.
"""
import asyncio
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import edge_tts

ROOT = Path(__file__).resolve().parents[2]
BUILD = Path(os.environ.get('DEMO_BUILD_DIR', str(Path(tempfile.gettempdir()) / 'bos-video-demo'))).resolve()

async def main():
    (BUILD / 'vo').mkdir(parents=True, exist_ok=True)
    script = (ROOT / 'docs/demo/video-script.md').read_text()
    lines = re.findall(r'\*\*Voiceover:\*\* “(.*?)”', script)
    metadata = []
    for number, text in enumerate(lines, 1):
        audio = BUILD / 'vo' / f'{number:02}.mp3'
        cache = audio.with_suffix('.txt')
        if not audio.exists() or not cache.exists() or cache.read_text() != text:
            await edge_tts.Communicate(text, os.environ.get('DEMO_VOICE', 'en-US-AriaNeural'), rate='+5%').save(str(audio))
            cache.write_text(text)
        duration = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(audio)], text=True))
        metadata.append({'id':number,'text':text,'file':str(audio),'duration':duration})
        print(f'{number}: {duration:.2f}s')
    (BUILD / 'voice.json').write_text(json.dumps(metadata, indent=2))

asyncio.run(main())
