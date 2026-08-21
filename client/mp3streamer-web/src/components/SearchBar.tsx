import { useEffect, useRef, useState } from 'react';

interface SearchBarProps {
  onSearch: (term: string) => void;
  placeholder?: string;
}

// Vendor-prefixed on Chrome/Android/Samsung Internet, absent entirely on
// some browsers (notably Safari/iOS support is inconsistent) — feature
// detect rather than assuming it exists, and just don't render the mic
// button when it doesn't.
const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;

// Backstop in case the browser's own recognition session hangs instead of
// firing its own result/error/end event — rare, but leaves the button
// stuck in "listening" forever if unguarded.
const LISTEN_TIMEOUT_MS = 8000;

// How long the "not available" error banner stays up before auto-dismissing.
const MIC_ERROR_DISMISS_MS = 20000;

export function SearchBar({ onSearch, placeholder }: SearchBarProps) {
  const [value, setValue] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => onSearch(value), 300);
    return () => clearTimeout(handle);
  }, [value, onSearch]);

  useEffect(() => {
    if (!micError) return;
    const handle = setTimeout(() => setMicError(false), MIC_ERROR_DISMISS_MS);
    return () => clearTimeout(handle);
  }, [micError]);

  // Unmount safety net, mirroring the pattern used for the audio
  // buffering fetch in NowPlayingBar.tsx.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      recognitionRef.current?.abort();
    };
  }, []);

  const clearListenTimeout = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const stopListening = () => {
    clearListenTimeout();
    recognitionRef.current = null;
    setIsListening(false);
  };

  const startListening = () => {
    if (!SpeechRecognitionCtor || isListening) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      setValue(transcript);
    };

    recognition.onerror = () => {
      // An explicit error already tells us the session is done — cancel the
      // 8s backstop now, rather than leaving it to fire later (if the
      // browser is slow to also raise `onend`) and re-trigger the error
      // banner right after it had already correctly dismissed itself.
      clearListenTimeout();
      setMicError(true);
    };
    recognition.onend = () => stopListening();

    recognitionRef.current = recognition;
    setMicError(false);
    setIsListening(true);
    recognition.start();

    timeoutRef.current = window.setTimeout(() => {
      setMicError(true);
      recognitionRef.current?.abort();
      stopListening();
    }, LISTEN_TIMEOUT_MS);
  };

  return (
    <div className="search-bar-wrap">
      <input
        className="search-bar"
        type="text"
        value={value}
        placeholder={placeholder ?? 'Search title, artist, album...'}
        onChange={(e) => setValue(e.target.value)}
      />
      {SpeechRecognitionCtor ? (
        <button
          type="button"
          className={`search-mic-btn${isListening ? ' listening' : ''}`}
          onClick={() => (isListening ? recognitionRef.current?.abort() : startListening())}
          aria-label={isListening ? 'Stop voice search' : 'Search by voice'}
        >
          <MicIcon />
        </button>
      ) : null}
      {micError ? (
        <div className="search-mic-error">
          Speak to text search is not available at this time. Try again later.
        </div>
      ) : null}
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </svg>
  );
}
