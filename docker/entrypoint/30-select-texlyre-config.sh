#!/bin/sh
set -eu

typesetter_url="${TEXLYRE_TYPESETTER_URL:-}"
typesetter_token="${TEXLYRE_TYPESETTER_PROXY_TOKEN:-}"
typesetter_config=/etc/texlyre/nginx/typesetter.conf

if [ -n "$typesetter_url" ]; then
	if [ -z "$typesetter_token" ]; then
		echo >&2 "TEXLYRE_TYPESETTER_URL requires TEXLYRE_TYPESETTER_PROXY_TOKEN"
		exit 1
	fi

	case "$typesetter_url" in
		ws://*) proxy_url="http://${typesetter_url#ws://}" ;;
		wss://*) proxy_url="https://${typesetter_url#wss://}" ;;
		http://*|https://*) proxy_url="$typesetter_url" ;;
		*)
			echo >&2 "TEXLYRE_TYPESETTER_URL must use ws://, wss://, http://, or https://"
			exit 1
			;;
	esac

	case "$proxy_url" in
		*[!A-Za-z0-9:/?\&=._~%@+,\[\]-]*)
			echo >&2 "TEXLYRE_TYPESETTER_URL contains unsupported characters"
			exit 1
			;;
	esac

	case "$typesetter_token" in
		*[!A-Za-z0-9._~+/=-]*)
			echo >&2 "TEXLYRE_TYPESETTER_PROXY_TOKEN must be a URL-safe or base64 secret"
			exit 1
			;;
	esac

	escaped_proxy_url=$(printf '%s' "$proxy_url" | sed 's/[\\&|]/\\&/g')
	escaped_token=$(printf '%s' "$typesetter_token" | sed 's/[\\&|]/\\&/g')
	sed \
		-e "s|__TEXLYRE_TYPESETTER_URL__|$escaped_proxy_url|g" \
		-e "s|__TEXLYRE_TYPESETTER_PROXY_TOKEN__|$escaped_token|g" \
		/etc/texlyre/nginx/typesetter.conf.template > "$typesetter_config"
else
	: > "$typesetter_config"
fi

if [ "${TLS_ENABLED:-false}" = "true" ]; then
	if [ ! -r /etc/nginx/certs/tls.crt ] || [ ! -r /etc/nginx/certs/tls.key ]; then
		echo >&2 "TLS_ENABLED=true requires /etc/nginx/certs/tls.crt and /etc/nginx/certs/tls.key"
		exit 1
	fi

	cp /etc/texlyre/nginx/https.conf /etc/nginx/conf.d/default.conf
else
	cp /etc/texlyre/nginx/http.conf /etc/nginx/conf.d/default.conf
fi
