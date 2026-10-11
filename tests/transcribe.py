import sys,wave,numpy as np
from scipy.signal import resample_poly
from pocketsphinx import Decoder, Config
w=wave.open(sys.argv[1]);n=w.getnframes();sr=w.getframerate();ch=w.getnchannels();assert sr==24000 and ch==1 and w.getsampwidth()==2
raw=np.frombuffer(w.readframes(n),dtype=np.int16).astype(np.float32)
x=resample_poly(raw,2,3).astype(np.int16)
d=Decoder(Config());d.start_utt()
for i in range(0,len(x),16000*20):d.process_raw(x[i:i+16000*20].tobytes(),False,False)
d.end_utt();print('%.2f'%(n/sr),'|',d.hyp().hypstr if d.hyp() else '')
