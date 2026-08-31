"""Lazy S3 template loader for Jinja2.

Used only when ``TEMPLATES_SOURCE == "s3"``. Instead of pre-loading every
template at cold start, each template is fetched from S3 the first time it is
referenced (by render, extends or include). Jinja's Environment caches the
compiled template by name, so S3 is hit at most once per template per warm
container — subsequent sends reuse the cached copy.

A missing key or any S3 error raises ``TemplateNotFound`` so a ``ChoiceLoader``
can fall back to the bundled templates.
"""
import logging

from jinja2 import BaseLoader, TemplateNotFound

import config

logger = logging.getLogger()

# S3 error codes that mean "this key isn't here" -> try the next candidate.
_NOT_FOUND_CODES = {"NoSuchKey", "404", "NoSuchBucket"}

_s3_client = None


def _client():
    global _s3_client
    if _s3_client is None:
        import boto3

        _s3_client = boto3.client("s3", region_name=config.SES_REGION)
    return _s3_client


class S3TemplateLoader(BaseLoader):
    """Fetches a single template from S3 on demand; relies on the Jinja
    Environment cache (auto_reload=False) to avoid refetching."""

    def __init__(self, bucket: str, prefix: str):
        self.bucket = bucket
        self.prefix = prefix

    def _candidate_keys(self, template: str):
        """The S3 keys to try for a template, in order. Accepts both the exact
        name (e.g. ``payment_approved.html.j2``) and the plain-HTML variant
        (``payment_approved.html``) so either can be uploaded."""
        keys = [f"{self.prefix}{template}"]
        if template.endswith(".j2"):
            keys.append(f"{self.prefix}{template[:-len('.j2')]}")  # .html.j2 -> .html
        return keys

    def get_source(self, environment, template):
        if not self.bucket:
            raise TemplateNotFound(template)

        # Imported here, not at module scope, for the same reason boto3 is: it
        # keeps this module -- and therefore the whole renderer -- importable
        # without botocore installed, so the preview harness runs on Jinja2 alone.
        # In Lambda both are provided by the runtime, so nothing changes there.
        from botocore.exceptions import ClientError

        for key in self._candidate_keys(template):
            try:
                body = _client().get_object(Bucket=self.bucket, Key=key)["Body"].read()
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "")
                if code in _NOT_FOUND_CODES:
                    continue  # not this key -> try the next candidate
                logger.warning("S3 error for '%s' (%s); falling back to bundled", key, code)
                raise TemplateNotFound(template) from exc
            except Exception as exc:  # noqa: BLE001 - connectivity etc. -> fall back
                logger.warning("S3 unavailable for '%s' (%s); falling back to bundled", key, exc)
                raise TemplateNotFound(template) from exc

            logger.info("Fetched template '%s' from s3://%s", key[len(self.prefix):], self.bucket)
            # filename=None, uptodate=None: with auto_reload=False the compiled
            # template is cached for the container lifetime (no refetch).
            return body.decode("utf-8"), None, None

        # No candidate key exists in S3 -> let ChoiceLoader fall back to bundled.
        raise TemplateNotFound(template)
