import os,re
from pathlib import Path
from huggingface_hub import HfApi

ROOT=Path(__file__).resolve().parents[1]
SPACE_ID=os.environ.get("HF_SPACE_ID","Smit1105/qstate-market-api")
TOKEN=os.environ["HF_TOKEN"]
api=HfApi(token=TOKEN)

api.create_repo(repo_id=SPACE_ID,repo_type="space",space_sdk="gradio",space_hardware="zero-a10g",exist_ok=True)\ntry:\n    api.request_space_hardware(repo_id=SPACE_ID,hardware="zero-a10g")\nexcept Exception:\n    pass

secret_map={
    "MASSIVE_KEY":os.environ.get("MASSIVE_KEY",""),
    "FMP_API_KEY":os.environ.get("FMP_API_KEY",""),
    "FINNHUB_API_KEY":os.environ.get("FINNHUB_API_KEY",""),
    "ALPHA_VANTAGE_KEY":os.environ.get("ALPHA_VANTAGE_KEY",""),
}
for key,value in secret_map.items():
    if value:
        api.add_space_secret(repo_id=SPACE_ID,key=key,value=value)

api.add_space_variable(repo_id=SPACE_ID,key="ALLOWED_ORIGIN",value=os.environ.get("ALLOWED_ORIGIN","https://samin110597-create.github.io"))
api.upload_folder(folder_path=str(ROOT/"backend"/"hf-space"),repo_id=SPACE_ID,repo_type="space",commit_message="Deploy Q-State request-time market API")

owner,name=SPACE_ID.split("/",1)
subdomain=re.sub(r"[^a-z0-9-]+","-",f"{owner}-{name}".lower()).strip("-")
print(f"HF_SPACE_ID={SPACE_ID}")
print(f"QSTATE_API_BASE=https://{subdomain}.hf.space")
