#!/bin/bash
set -e
cd /Users/tylerjette/relai/.vylan-ad
FF=/opt/homebrew/bin/ffmpeg
FPS=30

# per-beat durations (seconds) and motion focal: c=center push, l=pan-left, r=pan-right, t=push-up(top)
DUR=(1.7 1.8 1.8 2.0 1.8 1.8 1.9 1.8 2.6)
MOT=(c c r t c l c c c)
TRANS=(slideleft zoomin slideup wipeleft squeezeh slideright circleopen fadewhite)
XT=0.22  # transition duration

# ---- PART 1: per-beat motion clips ----
for n in 0 1 2 3 4 5 6 7 8; do
  d=${DUR[$n]}; mot=${MOT[$n]}
  TF=$(python3 -c "print(int(round($d*$FPS)))")
  # base centered push-in
  zexpr="min(zoom+0.0013,1.12)"
  xexpr="iw/2-(iw/zoom/2)"
  yexpr="ih/2-(ih/zoom/2)"
  case $mot in
    l) xexpr="iw/2-(iw/zoom/2)-(on/$TF-0.5)*90";;
    r) xexpr="iw/2-(iw/zoom/2)+(on/$TF-0.5)*90";;
    t) yexpr="ih/2-(ih/zoom/2)-(on/$TF-0.5)*120";;
  esac
  $FF -y -loglevel error -loop 1 -i beat-$n.png \
    -vf "scale=1080:1920,zoompan=z='$zexpr':d=$TF:x='$xexpr':y='$yexpr':s=1080x1920:fps=$FPS,format=yuv420p,setsar=1" \
    -frames:v $TF -an mclip-$n.mp4
  echo "beat $n -> $TF frames ($mot)"
done

# fade in from black on first beat (0.3s), fade out NOT (end card holds)
$FF -y -loglevel error -i mclip-0.mp4 -vf "fade=t=in:st=0:d=0.35,format=yuv420p,setsar=1" -c:v libx264 -crf 16 mclip-0f.mp4
mv mclip-0f.mp4 mclip-0.mp4

# ---- PART 2: xfade chain with varied transitions ----
# compute offsets
python3 - <<'PY' > /tmp/xfade_offsets.txt
DUR=[1.7,1.8,1.8,2.0,1.8,1.8,1.9,1.8,2.6]; XT=0.22
L=DUR[0]; offs=[]
for i in range(1,9):
    offs.append(round(L-XT,3)); L=round(L+DUR[i]-XT,3)
print(' '.join(str(o) for o in offs)); print('TOTAL',round(L,3))
PY
OFFS=($(sed -n '1p' /tmp/xfade_offsets.txt))
echo "offsets: ${OFFS[@]}"; sed -n '2p' /tmp/xfade_offsets.txt

FC=""
prev="[0:v]"
for i in 0 1 2 3 4 5 6 7; do
  nin=$((i+1)); out="x$nin"
  [ $i -eq 7 ] && out="vout"
  FC="${FC}${prev}[${nin}:v]xfade=transition=${TRANS[$i]}:duration=${XT}:offset=${OFFS[$i]}[${out}];"
  prev="[${out}]"
done
FC="${FC%;}"

$FF -y -loglevel error \
  -i mclip-0.mp4 -i mclip-1.mp4 -i mclip-2.mp4 -i mclip-3.mp4 -i mclip-4.mp4 \
  -i mclip-5.mp4 -i mclip-6.mp4 -i mclip-7.mp4 -i mclip-8.mp4 \
  -filter_complex "$FC" -map "[vout]" -r $FPS -c:v libx264 -pix_fmt yuv420p -crf 16 -preset medium video_kinetic.mp4
echo "VIDEO done:"; /opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video_kinetic.mp4
