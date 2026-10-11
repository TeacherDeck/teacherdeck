# SPDX-License-Identifier: GPL-3.0-only
# Additional terms: see LICENSE-ADDITIONAL-TERMS
"""Synthetic stdlib regressions; no network, provider execution or real media."""
import hashlib
import io
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import media_worker as worker


class WorkerTests(unittest.TestCase):
    def test_input_bound_and_shape(self):
        for data in (b"x" * 8193, b"[]"):
            with patch.object(worker.sys, "stdin", types.SimpleNamespace(buffer=io.BytesIO(data))):
                with self.assertRaises(worker.SafeFailure): worker.bounded_input()

    def test_provider_text_never_emitted(self):
        for text, code in (("synthetic private path: sign in", "authentication-required"), ("Requested format private-url", "combined-format-unavailable"), ("SSL certificate private-path", "network-certificate")):
            with self.assertRaises(worker.SafeFailure) as error: worker.SilentLogger().error(text)
            self.assertEqual(error.exception.code, code)

    def archive(self, names):
        raw = io.BytesIO()
        with zipfile.ZipFile(raw, "w") as archive:
            for name in names: archive.writestr(name, b"synthetic")
        return raw.getvalue()

    def provision_synthetic(self, data, directory, expected_hash=None):
        class Response(io.BytesIO):
            url = "https://release-assets.githubusercontent.com/synthetic"
        runtime = ("https://github.com/synthetic", len(data), expected_hash or hashlib.sha256(data).hexdigest(), "deno.exe", 9, hashlib.sha256(b"synthetic").hexdigest())
        with patch.dict(worker.RUNTIMES, {"deno": runtime}), patch.object(worker, "runtime_response", return_value=Response(data)), patch.object(worker, "emit"):
            worker.provision({"mode":"provision", "directory":str(directory), "engine":"deno"})

    def test_runtime_exact_new_file_and_hash(self):
        with tempfile.TemporaryDirectory(prefix="deck-media-synthetic-") as temp:
            directory=Path(temp);data=self.archive(["deno.exe"])
            self.provision_synthetic(data,directory)
            self.assertEqual((directory/"deno.exe").read_bytes(),b"synthetic")
            with self.assertRaises(worker.SafeFailure): self.provision_synthetic(data,directory)
            self.assertEqual((directory/"deno.exe").read_bytes(),b"synthetic")

    def test_runtime_wrong_hash_traversal_duplicates_and_extra_entries(self):
        for names, expected_hash in ((["deno.exe"],"0"*64), (["../deno.exe"],None), (["deno.exe","other.exe"],None), (["deno.exe","deno.exe"],None)):
            with tempfile.TemporaryDirectory(prefix="deck-media-synthetic-") as temp:
                directory=Path(temp)
                with self.assertRaises(worker.SafeFailure): self.provision_synthetic(self.archive(names),directory,expected_hash)
                self.assertFalse((directory/"deno.exe").exists())

    def test_fixed_options_and_combined_input_size_bound(self):
        with tempfile.TemporaryDirectory(prefix="deck-media-synthetic-") as temporary:
            directory=Path(temporary);deno=directory/"deno.exe";deno.write_bytes(b"synthetic")
            captured={}
            class Downloader:
                def __init__(self,options): self.params=options;captured.update(options)
                def __enter__(self): return self
                def __exit__(self,*_): pass
                def extract_info(self,url,download):
                    if url!="https://www.youtube.com/watch?v=AAAAAAAAAAA" or download: raise AssertionError("unexpected request")
                    return {"id":"AAAAAAAAAAA","availability":"public","formats":[
                        {"ext":"mp4","protocol":"https","vcodec":"avc1","acodec":"none","height":720,"fps":30,"filesize":9},
                        {"ext":"m4a","protocol":"https","vcodec":"none","acodec":"mp4a","filesize":9}]}
                def process_info(self,info):
                    Path(self.params["outtmpl"]["default"]).write_bytes(b"synthetic")
                    captured["progress_hooks"][0]({"downloaded_bytes":9,"total_bytes":9,"status":"finished"})
            plugin_dirs=types.SimpleNamespace(value=["default"])
            modules={"yt_dlp":types.SimpleNamespace(YoutubeDL=Downloader),"yt_dlp.globals":types.SimpleNamespace(plugin_dirs=plugin_dirs)}
            request={"mode":"download","videoId":"AAAAAAAAAAA","directory":str(directory),"deno":str(deno)}
            with patch.dict(worker.sys.modules,modules),patch.object(worker,"hash_file",side_effect=[worker.DENO_EXE_SHA256,*[sha for _,sha in worker.WHEELS]]),patch.object(worker,"emit") as emit:
                worker.download(request)
            self.assertEqual(plugin_dirs.value,[]);self.assertEqual(captured["remote_components"],[])
            self.assertIsNone(captured["cookiefile"]);self.assertEqual(captured["postprocessors"],[])
            self.assertEqual(captured["allowed_extractors"],["youtube"])
            emit.assert_called_with("done",size=18)
            for count in (-100,worker.MAX_BYTES+1,True):
                with self.assertRaises(worker.SafeFailure):captured["progress_hooks"][0]({"downloaded_bytes":count})

    def test_no_extra_process_cookie_or_url_arguments(self):
        with self.assertRaises(worker.SafeFailure):worker.download({"mode":"download","videoId":"AAAAAAAAAAA","directory":"synthetic","deno":"synthetic","cookiefile":"synthetic"})

    def test_combined_only_mp4_keeps_the_previous_supported_fallback(self):
        with tempfile.TemporaryDirectory(prefix="deck-media-synthetic-") as temporary:
            directory=Path(temporary);deno=directory/"deno.exe";deno.write_bytes(b"synthetic")
            class Downloader:
                def __init__(self,options):self.params=options
                def __enter__(self):return self
                def __exit__(self,*_):pass
                def extract_info(self,*_,**__):return {"id":"AAAAAAAAAAA","availability":"public","formats":[{"ext":"mp4","protocol":"https","vcodec":"avc1","acodec":"mp4a","height":360,"fps":30}]}
                def process_info(self,info):Path(self.params["outtmpl"]["default"]).write_bytes(b"synthetic")
            modules={"yt_dlp":types.SimpleNamespace(YoutubeDL=Downloader),"yt_dlp.globals":types.SimpleNamespace(plugin_dirs=types.SimpleNamespace(value=[]))}
            with patch.dict(worker.sys.modules,modules),patch.object(worker,"hash_file",side_effect=[worker.DENO_EXE_SHA256,*[sha for _,sha in worker.WHEELS]]),patch.object(worker,"emit") as emit:
                worker.download({"mode":"download","videoId":"AAAAAAAAAAA","directory":str(directory),"deno":str(deno)})
            self.assertEqual((directory/"video.mp4").read_bytes(),b"synthetic")
            self.assertFalse((directory/"video-only.mp4").exists())
            emit.assert_called_with("done",size=9)

    def test_runtime_redirect_rejects_before_contacting_unknown_or_plain_http(self):
        for address in ("http://github.com/synthetic","https://example.invalid/synthetic","https://github.com@localhost/synthetic","https://github.com:444/synthetic"):
            self.assertFalse(worker.runtime_address_allowed(address))
            with self.assertRaises(worker.SafeFailure):worker.RuntimeRedirect().redirect_request(None,None,302,"",{},address)
        self.assertTrue(worker.runtime_address_allowed("https://release-assets.githubusercontent.com/synthetic"))


if __name__ == "__main__":
    unittest.main()
