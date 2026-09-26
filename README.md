This code is for a cloudflare worker for the Kingdom of Loathing which provides an easy to use autoadventure, adapted for all devices, along with a spleen counter, and a snapshot (accessible at your-worker-name.your-username.workers.dev/snapshot)


To use this, create a cloudflare worker, along with a KV namespace (also in cloudflare).
Bind the namespace to the worker.
Create a secret environment variable named KV_SEED_KEY and mark it as encrypted 
Download the txt files from AV snapshot
Go to your cloudflare worker at your-worker-name.your-username.workers.dev/kv-seed
Fill in the password blank with your KV_SEED_KEY
Upload the txt files and you’re done!

Credit to DonCannoli for good ideas, AV snapshot for snapshot code and Anthropic’s Claude for screening.
