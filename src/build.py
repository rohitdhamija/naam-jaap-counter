# Rebuild the app: run from the repo root ->  python3 src/build.py
import re
h=open('src/index.html').read()
parts={'MUXER':'src/vendor/mp4-muxer.js','DETECT':'src/detect.js','RENDER':'src/render.js','APP':'src/app.js'}
for k,p in parts.items():
    s=open(p).read().replace('</script','<\\/script')
    h=h.replace('/*__%s__*/'%k, s)
open('index.html','w').write(h)
print(len(h))
