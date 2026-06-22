#!/bin/bash
set -e
cd /Users/tylerjette/relai/.vylan-ad
FF=/opt/homebrew/bin/ffmpeg
DUR=15.4667

$FF -y -loglevel error \
 -i video_kinetic.mp4 \
 -i sfx-ambient.mp3 -i sfx-swipe.mp3 -i sfx-click.mp3 -i sfx-ding.mp3 -i sfx-riser.mp3 -i sfx-boom.mp3 \
 -filter_complex "
[0:v]eq=contrast=1.06:saturation=1.09,vignette,format=yuv420p[vpol];
[1:a]atrim=0:15.47,asetpts=N/SR/TB,volume=0.10,afade=t=in:st=0:d=0.4,afade=t=out:st=14.7:d=0.7[amb];
[2:a]asplit=7[sa][sb][sc][sd][se][sf][sg];
[sa]volume=0.42,adelay=1510:all=1[w0];
[sb]volume=0.42,adelay=3090:all=1[w1];
[sc]volume=0.42,adelay=4670:all=1[w2];
[sd]volume=0.42,adelay=6450:all=1[w3];
[se]volume=0.42,adelay=8030:all=1[w4];
[sf]volume=0.42,adelay=9610:all=1[w5];
[sg]volume=0.42,adelay=11290:all=1[w6];
[3:a]asplit=2[ca][cb];
[ca]volume=0.30,adelay=1780:all=1[k0];
[cb]volume=0.30,adelay=8200:all=1[k1];
[4:a]asplit=2[da][db];
[da]volume=0.55,adelay=4900:all=1[g0];
[db]volume=0.40,adelay=13280:all=1[g1];
[5:a]volume=0.50,adelay=11500:all=1[ri];
[6:a]asplit=2[ba][bb];
[ba]volume=0.42,adelay=60:all=1[bo0];
[bb]volume=0.58,adelay=13030:all=1[bo1];
[amb][w0][w1][w2][w3][w4][w5][w6][k0][k1][g0][g1][ri][bo0][bo1]amix=inputs=15:normalize=0:duration=longest:dropout_transition=0,alimiter=limit=0.95,aresample=48000[aout]
" -map "[vpol]" -map "[aout]" -t $DUR \
 -c:v libx264 -pix_fmt yuv420p -crf 20 -preset medium -c:a aac -b:a 192k -movflags +faststart vylan-ad-v2.mp4
echo "exit=$?"
/opt/homebrew/bin/ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of default=noprint_wrappers=1 vylan-ad-v2.mp4
echo "=== audio level ==="
$FF -hide_banner -i vylan-ad-v2.mp4 -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
