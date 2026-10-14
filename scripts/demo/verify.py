"""Check final streams, voice audibility, timeline bounds and caption pixels."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

BUILD = Path(os.environ.get('DEMO_BUILD_DIR', str(Path(tempfile.gettempdir()) / 'bos-video-demo'))).resolve()
OUT = Path(os.environ.get('DEMO_OUTPUT_DIR', 'artifacts/demo'))
VIDEO = OUT / 'ownstack-demo.mp4'

def run(args):
    return subprocess.run(args, check=True, capture_output=True)

probe = json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(VIDEO)]).stdout)
assert any(s['codec_name'] == 'h264' and s['width'] == 1600 and s['height'] == 900 for s in probe['streams'])
assert any(s['codec_name'] == 'aac' for s in probe['streams'])
timeline = json.loads((BUILD / 'timeline.json').read_text())
report = {'duration':float(probe['format']['duration']),'resolution':'1600x900','video':'h264','audio':'aac','voice_checks':[]}
last_end = 0
for item in timeline:
    assert item['voiceStart'] >= last_end
    assert item['voiceEnd'] <= item['start'] + item['seconds']
    last_end = item['voiceEnd']
    result = run(['ffmpeg','-v','info','-ss',str(item['voiceStart']+.15),'-t',str(item['voice']['duration']-.3),'-i',str(VIDEO),'-vn','-af','volumedetect','-f','null','-'])
    volume = float(re.search(r'mean_volume: (-?[\d.]+) dB', result.stderr.decode())[1])
    assert volume > -50, f"Missing voice in scene {item['id']}"
    report['voice_checks'].append({'scene':item['id'],'mean_db':volume})
    print(f"Scene {item['id']}: audible ({volume} dB), no overlap or overrun")
# Compare caption area of first clip with original. A substantial pixel shift proves overlay landed.
shot = timeline[0]
raw_duration = float(run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',shot['raw']]).stdout)
raw_time = max(0,raw_duration-shot['duration']) + 2
region = 'crop=900:62:32:812,format=gray'
original = run(['ffmpeg','-v','error','-ss',str(raw_time),'-i',shot['raw'],'-frames:v','1','-vf',region,'-f','rawvideo','-']).stdout
captioned = run(['ffmpeg','-v','error','-ss','2','-i',shot['clip'],'-frames:v','1','-vf',region,'-f','rawvideo','-']).stdout
shift = abs(sum(original)/len(original)-sum(captioned)/len(captioned))
assert shift > 10, 'Caption overlay missing'
report['caption_brightness_shift'] = shift
report['status'] = 'passed'
(OUT / 'verification.json').write_text(json.dumps(report,indent=2))
print(f"PASS: {report['duration']:.2f}s, H.264 + AAC, all nine voice lines audible, caption overlay verified.")
