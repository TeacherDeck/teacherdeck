// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from '@deck/sdk';
import { Body, Button, CheckBox, DropZone, InfoBar, ListView, NumberBox, ProgressBar, SettingsExpander, ToolLayout, makeStyles, tokens } from '@deck/ui';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_OPTIONS, encode, loadOptions, runBatch, saveOptions, supported, type Result } from './batch.ts';
const useStyles = makeStyles({ list: { maxHeight: '30vh', overflowY: 'auto' }, actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM }, options: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalL } });
const bytes = (size: number) => `${(size / 1024 / 1024).toFixed(2)} MB`;
export function App({ deck }: { deck: Deck }) {
  const styles = useStyles();
  const [files, setFiles] = useState<FileHandleInfo[]>([]);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [parent, setParent] = useState<FolderHandleInfo | null>(null);
  const [folder, setFolder] = useState<FolderHandleInfo | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void loadOptions(deck).then((value) => { if (active) setOptions(value); }).catch(() => undefined);
    return () => { active = false; controller.current?.abort(); };
  }, [deck]);
  useEffect(() => deck.on('fs.dropped', (incoming) => {
    if (busy.current) return;
    addFiles(incoming.files);
    if (automatic && parent) void run(incoming.files.filter(supported));
  }), [deck, running, automatic, parent, options]);
  function addFiles(incoming: FileHandleInfo[]) {
    const accepted = incoming.filter(supported);
    setFiles((current) => [...new Map([...current, ...accepted].map((file) => [file.handle, file])).values()]);
    setResults([]); setFolder(null);
    setMessage(accepted.length !== incoming.length ? 'JPG, PNG, WebP만 추가해요. 움직이는 이미지와 HEIC는 지원하지 않아요.' : '');
  }
  async function pickFiles() {
    try { addFiles(await deck.fs.pickFiles({ multiple: true, filters: [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] })); }
    catch { setMessage('파일을 선택하지 못했어요. 다시 선택해 주세요.'); }
  }
  async function pickFolder() {
    try { const picked = await deck.fs.pickFolder(); if (picked) setParent(picked); }
    catch { setMessage('폴더를 선택하지 못했어요. 다시 선택해 주세요.'); }
  }
  async function run(selected: readonly FileHandleInfo[] = files) {
    if (busy.current || !selected.length) return;
    busy.current = true;
    let target = parent;
    try { if (!target) target = await deck.fs.pickFolder(); } catch { setMessage('폴더를 선택하지 못했어요. 다시 선택해 주세요.'); }
    if (!target) { busy.current = false; return; }
    setParent(target);
    const abort = new AbortController(); controller.current = abort;
    setTotal(selected.length); setRunning(true); setResults([]); setFolder(null); setMessage('');
    void saveOptions(deck, options).catch(() => undefined);
    try {
      const output = await runBatch(deck, selected, target.handle, options, abort.signal, encode, setResults);
      setFolder(output.folder); setResults(output.results);
      setMessage(abort.signal.aborted ? '취소했어요. 이미 저장한 결과는 새 폴더에 남아요.' : `${output.results.filter((r) => r.status !== 'failed').length}개 이미지를 저장했어요.`);
    } catch { setMessage('결과 폴더를 사용하지 못했어요. 저장 폴더를 다시 선택해 주세요.'); }
    finally { busy.current = false; setRunning(false); controller.current = null; }
  }
  return <ToolLayout title="이미지 용량 줄이기" description="여러 이미지를 한 번에 줄여 새 폴더에 저장해요. 원본은 그대로 남아요.">
    <ToolLayout.Section step="input" title="1. 이미지 추가">
      {!running && <DropZone onPick={() => { void pickFiles(); }} description="JPG · PNG · WebP를 끌어 놓거나 파일을 선택해 주세요." />}
      <div className={styles.actions}><Button appearance="primary" disabled={running || !files.length} onClick={() => { void run(); }}>압축하여 저장</Button><Button disabled={!running} onClick={() => controller.current?.abort()}>취소</Button></div><CheckBox content="파일 추가 시 바로 압축" checked={automatic} disabled={running || !parent} onChange={setAutomatic} /><Body secondary>처음에는 저장 폴더를 선택해요. 바로 압축은 이 화면에서만 적용돼요.</Body><Body>{files.length}개 · {bytes(files.reduce((sum, file) => sum + file.size, 0))}</Body>
      <Button disabled={running || !files.length} onClick={() => { setFiles([]); setResults([]); setFolder(null); }}>목록 비우기</Button>
    </ToolLayout.Section>
    <ToolLayout.Section step="options" title="2. 압축 설정">
      <SettingsExpander header="압축 설정" description={`품질 ${options.quality}% · 긴 변 ${options.maxEdge}px`}><div className={styles.options}><NumberBox header="품질 (%)" value={options.quality} min={10} max={100} onChange={(quality) => { if (!running) setOptions({ ...options, quality }); }} /><NumberBox header="긴 변 최대 크기 (px)" value={options.maxEdge} min={100} max={10000} onChange={(maxEdge) => { if (!running) setOptions({ ...options, maxEdge }); }} /></div></SettingsExpander>
      <Body secondary>작은 이미지는 확대하지 않아요. 투명도를 유지하는 WebP로 저장해요. 용량이 줄지 않으면 원본을 복사해요.</Body>
      <Button disabled={running} onClick={() => { void pickFolder(); }}>저장 폴더 선택</Button><Body>{parent ? parent.name : '저장할 상위 폴더를 선택해 주세요.'}</Body>
    </ToolLayout.Section>
    <ToolLayout.Section step="preview" title="3. 입력 확인">
      <div className={styles.list}><ListView header="선택한 이미지" items={files} getKey={(file) => file.handle} renderItem={(file) => <Body>{file.name} · {bytes(file.size)}</Body>} emptyText="파일을 추가하면 여기에서 확인할 수 있어요." /></div>
      <Body secondary>64 MB 또는 4,800만 화소를 넘는 이미지는 건너뛰어요. 압축된 파일에서는 촬영 정보가 제거돼요. 원본 복사에는 촬영 정보가 남아요.</Body>
    </ToolLayout.Section>
    <ToolLayout.Section step="run" title="4. 압축">
      <div className={styles.actions}><Body secondary>위의 압축하여 저장을 누르면 새 폴더에 결과를 저장해요.</Body></div>
      {running && <><ProgressBar header="압축 진행" value={results.length / total} /><Body aria-live="polite">{results.length} / {total}개 처리했어요.</Body></>}
    </ToolLayout.Section>
    <ToolLayout.Section step="result" title="5. 결과">
      {message && <InfoBar severity="informational" message={message} />}
      <div className={styles.list}><ListView header="압축 결과" items={results} getKey={(result) => result.file.handle} renderItem={(result) => <Body>{result.file.name} · {result.status === 'failed' ? '처리하지 못했어요. 형식과 크기를 확인해 주세요.' : `${result.status === 'original' ? '원본 복사' : '압축'} · ${bytes(result.file.size)} → ${bytes(result.outputSize ?? 0)}`}</Body>} /></div><Button disabled={running || !results.some((r) => r.status === "failed")} onClick={() => { void run(results.filter((r) => r.status === "failed").map((r) => r.file)); }}>실패한 파일 재시도</Button>
      {folder && <Button onClick={() => { void deck.fs.reveal(folder.handle).catch(() => setMessage('결과 폴더를 열지 못했어요. 저장 폴더에서 확인해 주세요.')); }}>결과 폴더 열기</Button>}
    </ToolLayout.Section>
  </ToolLayout>;
}