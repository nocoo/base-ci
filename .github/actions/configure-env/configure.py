import json
import os
import re
import uuid
from pathlib import Path


def parse_environment(raw):
    values = json.loads(raw or '{}')
    if not isinstance(values, dict):
        raise ValueError('Test environment must be a JSON object')
    for key, value in values.items():
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key):
            raise ValueError('Invalid test environment variable name')
        if key.startswith(('GITHUB_', 'RUNNER_')) or key == 'NODE_OPTIONS':
            raise ValueError('Reserved GitHub environment variable')
        if not isinstance(value, str) or '\0' in value:
            raise ValueError('Test environment values must be strings without NUL bytes')
    return values


def configure(public_json, secret_json, output_file):
    public = parse_environment(public_json)
    secrets = parse_environment(secret_json)
    values = {**public, **secrets, 'CI': 'true'}
    for value in secrets.values():
        if value:
            escaped = value.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
            print(f'::add-mask::{escaped}', flush=True)
    with Path(output_file).open('a', encoding='utf-8') as output:
        for key, value in values.items():
            delimiter = f'base_ci_{uuid.uuid4().hex}'
            output.write(f'{key}<<{delimiter}\n{value}\n{delimiter}\n')


if __name__ == '__main__':
    configure(os.environ['BASE_CI_ENV_JSON'], os.environ['BASE_CI_SECRET_ENV_JSON'], os.environ['GITHUB_ENV'])
