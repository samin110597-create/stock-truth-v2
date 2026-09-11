import {analyze} from '../src/analysis.mjs';
self.onmessage=event=>{
  const {id,raw,benchmarks}=event.data;
  try{self.postMessage({id,analysis:analyze(raw,{benchmarks})});}catch(error){self.postMessage({id,error:error.message});}
};
