.PHONY: build init up stop logs

build:
	docker compose build

init:
	@touch .env
	docker compose build
	docker compose run --rm --no-deps -v "$(CURDIR):/app/env" waha init-waha /app/env
	chmod 600 .env

up:
	docker compose up -d --build

stop:
	docker compose down

logs:
	docker compose logs -f waha
