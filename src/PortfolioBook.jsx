import React, { useEffect, useState, useRef, useCallback } from "react";
import HTMLFlipBook from "react-pageflip";
import * as pdfjsLib from "pdfjs-dist";

// ✅ Vite-compatible worker import
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?worker&url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const SPLIT_PAGES = true;
const SCALE = 2; // control image quality

export default function PortfolioBook() {
  const [pageCount, setPageCount] = useState(0);
  const [pages, setPages] = useState({}); // store {pageIndex: imageDataURL}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const bookRef = useRef(null);
  const pdfRef = useRef(null);

  // Lazy-load a single page
  const loadPageImage = useCallback(async (pdf, pdfPageNum) => {
    const page = await pdf.getPage(pdfPageNum);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport }).promise;

    if (SPLIT_PAGES) {
      const halfW = Math.floor(canvas.width / 2);
      const left = document.createElement("canvas");
      left.width = halfW;
      left.height = canvas.height;
      left.getContext("2d").drawImage(canvas, 0, 0, halfW, canvas.height, 0, 0, halfW, canvas.height);

      const rightW = canvas.width - halfW;
      const right = document.createElement("canvas");
      right.width = rightW;
      right.height = canvas.height;
      right.getContext("2d").drawImage(canvas, halfW, 0, rightW, canvas.height, 0, 0, rightW, canvas.height);

      return [left.toDataURL("image/png"), right.toDataURL("image/png")];
    } else {
      return [canvas.toDataURL("image/png")];
    }
  }, []);

  // Preload surrounding pages for smoother flipping
  const preloadPagesAround = useCallback(async (currentIndex) => {
    if (!pdfRef.current) return;

    const preloadIndexes = [currentIndex, currentIndex + 1, currentIndex + 2];
    for (const idx of preloadIndexes) {
      if (idx < 0 || idx >= pageCount) continue;
      if (!pages[idx]) {
        const pdfPageNum = SPLIT_PAGES ? Math.floor(idx / 2) + 1 : idx + 1;
        const [img] = SPLIT_PAGES
          ? await loadPageImage(pdfRef.current, pdfPageNum).then((arr) => [arr[idx % 2]])
          : await loadPageImage(pdfRef.current, pdfPageNum);
        setPages((prev) => ({ ...prev, [idx]: img }));
      }
    }
  }, [pageCount, pages, loadPageImage]);

  // Load PDF metadata only once
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const pdf = await pdfjsLib.getDocument("/portfolio.pdf").promise;
        pdfRef.current = pdf;

        const count = SPLIT_PAGES ? pdf.numPages * 2 : pdf.numPages;
        setPageCount(count);

        // Load the first spread immediately
        await preloadPagesAround(0);

        setLoading(false);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err.message || "Failed to load PDF");
          setLoading(false);
        }
      }
    }
    init();
    return () => { cancelled = true; };
  }, [preloadPagesAround]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      if (!bookRef.current) return;
      if (e.key === "ArrowRight") bookRef.current.pageFlip().flipNext();
      if (e.key === "ArrowLeft") bookRef.current.pageFlip().flipPrev();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Go-to-page handler
  const goToPage = (pageNumber) => {
    if (!bookRef.current) return;
    const targetIndex = Math.max(0, Math.min(pageCount - 1, pageNumber - 1));
    bookRef.current.pageFlip().flip(targetIndex);
  };

  if (loading) return <div>Loading PDF…</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {/* Go-to-page input */}
      <div style={{ marginBottom: "10px", textAlign: "center" }}>
        <label>
          Go to page:{" "}
          <input
            type="number"
            min="1"
            max={pageCount}
            onKeyDown={(e) => {
              if (e.key === "Enter") goToPage(Number(e.target.value));
            }}
            placeholder={`1-${pageCount}`}
          />
        </label>
      </div>

      <div className="bookWrap">
        <HTMLFlipBook
          width={900}
          height={1000}
          size="stretch"
          minWidth={300}
          maxWidth={1400}
          minHeight={300}
          maxHeight={2000}
          maxShadowOpacity={0.5}
          showCover={false}
          mobileScrollSupport={true}
          ref={bookRef}
          onFlip={(e) => {
            preloadPagesAround(e.data);
          }}
        >
          {Array.from({ length: pageCount }).map((_, i) => (
            <div key={i} className="page">
              {pages[i] ? (
                <img
                  src={pages[i]}
                  alt={`page-${i}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div style={{ textAlign: "center", padding: "50px" }}>Loading...</div>
              )}
            </div>
          ))}
        </HTMLFlipBook>
      </div>
    </div>
  );
}
