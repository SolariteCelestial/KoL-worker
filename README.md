To use this, create a cloudflare worker, along with a KV namespace (also in cloudflare).
Bind the namespace to the worker.
Create a secret environment variable named KV_SEED_KEY and mark it as encrypted 
Download the txt files from AV snapshot
The to (your worker name).(your username).workers.dev/kv-seed
Fill in the password blank with your KV_SEED_KEY
Upload the txt files and you’re done!
