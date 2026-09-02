#!/usr/bin/env bash

set -euo pipefail

key_directory="${HSC_ANDROID_KEY_DIRECTORY:-$HOME/Library/Application Support/Thoughtless Labs/Hide and Seek Cards}"
key_file="$key_directory/android-upload.jks"
key_alias="hide-and-seek-cards-upload"
keychain_service="com.thoughtlesslabs.hideandseekcards.android-upload"

if [[ -f "$key_file" ]]; then
  echo "Android upload key already exists at $key_file"
  exit 0
fi

mkdir -p "$key_directory"
chmod 700 "$key_directory"

store_password="$(openssl rand -base64 48 | tr -d '\n')"
key_password="$store_password"

keytool -genkeypair \
  -keystore "$key_file" \
  -storetype PKCS12 \
  -storepass "$store_password" \
  -alias "$key_alias" \
  -keypass "$key_password" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -dname "CN=Hide & Seek Cards Upload, O=Thoughtless Labs"

chmod 600 "$key_file"
security add-generic-password -U -s "$keychain_service" -a store-password -w "$store_password" >/dev/null
security add-generic-password -U -s "$keychain_service" -a key-password -w "$key_password" >/dev/null

unset store_password key_password

echo "Created Android upload key at $key_file"
echo "Stored its passwords in macOS Keychain under $keychain_service"
echo "Back up the key file in an encrypted, access-controlled off-device vault before Play submission."
