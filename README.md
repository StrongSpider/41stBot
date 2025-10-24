# 41st Bot (made by spiider.dev)

## Requirements 
You will need installed: 
- nodejs version 24+ and npm 11+
- PostgreSQL (google how to install)
- `pm2` npm package installed globally (`npm i pm2 -g`)

## Setup
Once you have cloned this repository, you first need to setup the `config.json` file.

Start by copying the contents of `configTemplate.json` into a new file called `config.json` in the main project directory.
Replace the empty strings with their respective values. You can change the pre-filled values if needed.

To set up the database, run `PGPASSWORD='<POSTGRES_PASSWORD>' psql -h '<POSTGRES_HOST>' -p <POSTGRES_PORT> -U '<POSTGRES_USER>' -d '<POSTGRES_DATABASE>' -f schema.sql` (replace the temp values with the real ones)

Next, you will need to run `npm install` inside the main project directory.

In order to run the scripts continuously, run the commands:
`pm2 start npm --name "41st Discord Bot" -- run bot`
`pm2 start npm --name "41st VIP Tracker" -- run tracker`
`pm2 start npm --name "41st Roblox Updater" -- run updater`
`pm2 start npm --name "41st Server" -- run server` ONLY IF YOU WANT TO SET UP SERVER (NEEDS EXTRA WORK)

### Server Setup
In order for some extra functionality like external API requests for 41st games and an advanced event management portal to work, you need to set up port forwarding and a domain for the port `8081`. You can change this in the `config.json` file.