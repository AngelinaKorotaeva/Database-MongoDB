## Cíl projektu

Cílem projektu je vytvořit plně automatizované distribuované prostředí MongoDB pomocí Docker Compose.

Projekt demonstruje:

- konfiguraci shardovaného MongoDB clusteru,
- replikační sady,
- automatickou inicializaci databáze,
- zabezpečení pomocí autentizace a keyfile,
- import dat,
- orchestrace kontejnerů pomocí Docker Compose,
- práci s Mongo Express webovým rozhraním.

Řešení je navrženo tak, aby bylo možné celý cluster spustit automaticky jedním příkazem bez manuální konfigurace.

## Spuštění projektu

Projekt je možné spustit jak na Windows, tak na Linuxu.
Řešení je plně automatizované pomocí Docker Compose a inicializačních skriptů.

1. Přechod do složky

Nejprve se přesuňte do složky s funkčním řešením:

cd Funkcni_reseni
2. Spuštění podle operačního systému
🪟 Windows

Spusťte dávkový skript:

start.bat
🐧 Linux

Spusťte shell skript:

chmod +x start.sh
./start.sh
3. Co skript provádí

Skript automaticky:

Zastaví případně běžící kontejnery
Vyčistí data
Spustí bootstrap cluster (bez autentizace)
Inicializuje replikační sady a naimportuje data
Vypne bootstrap cluster
Spustí zabezpečený cluster (autentizace + keyfile)
Počká na připravenost služby mongos
4. Přístup k aplikaci

Po úspěšném spuštění:

MongoDB (mongos):

mongodb://admin@localhost:27017/admin
Mongo Express (web UI):
http://localhost:8082
5. Poznámka
Spuštění je plně automatizované, není nutné ručně spouštět žádné další skripty.
Skripty start.bat a start.sh jsou pouze pomocné — hlavní orchestrace probíhá pomocí docker-compose.yml.
