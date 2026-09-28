Deno.serve(() => new Response(JSON.stringify({status:"OK",service:"Q-State Deno smoke"}), {
  headers: {"content-type":"application/json; charset=utf-8"}
}));
