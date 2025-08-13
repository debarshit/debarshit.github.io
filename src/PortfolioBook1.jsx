import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import FlipPage from "react-flip-page";
import * as pdfjsLib from "pdfjs-dist";

// ✅ Vite-compatible worker import
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?worker&url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const SCALE = 2;
const PRELOAD_RANGE = 2; // Preload 3 pages ahead/behind

export default function PortfolioBook() {
  const [pageCount, setPageCount] = useState(0);
  const [pages, setPages] = useState(new Map());
  const [loadingPages, setLoadingPages] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pdfRef = useRef(null);
  const flipPageRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(0);
  const loadingQueue = useRef(new Set());
  
  // Memoize page dimensions to prevent unnecessary recalculations
  const [baseDimensions, setBaseDimensions] = useState({ 
    ratio: 1.4, 
    baseWidth: 0, 
    baseHeight: 0 
  });

  // 🖼️ Optimized page loading with caching and error handling
  const loadPageImage = useCallback(async (pdf, pdfPageNum) => {
    if (!pdf) return null;
    
    try {
      const page = await pdf.getPage(pdfPageNum);
      const viewport = page.getViewport({ scale: SCALE });
      
      // Use OffscreenCanvas if available for better performance
      const canvas = typeof OffscreenCanvas !== 'undefined' 
        ? new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        : document.createElement("canvas");
      
      if (!canvas.getContext) {
        // Fallback for regular canvas
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
      }
      
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Clean up page resources
      page.cleanup();
      
      return canvas.toDataURL ? canvas.toDataURL("image/png") : canvas.convertToBlob().then(blob => URL.createObjectURL(blob));
    } catch (err) {
      console.error(`Failed to load page ${pdfPageNum}:`, err);
      return null;
    }
  }, []);

  // 🚀 Smart preloading with priority queue
  const preloadPagesAround = useCallback(
    async (currentIndex, priority = false) => {
      if (!pdfRef.current || pageCount === 0) return;

      const pagesToLoad = [];
      
      // Priority loading for current visible pages
      if (priority) {
        // Always include the current page (this fixes the first page issue)
        pagesToLoad.push(currentIndex);
        if (currentIndex + 1 < pageCount) {
          pagesToLoad.push(currentIndex + 1);
        }
      } else {
        // Background preloading
        for (let i = -PRELOAD_RANGE; i <= PRELOAD_RANGE + 1; i++) {
          const idx = currentIndex + i;
          if (idx >= 0 && idx < pageCount && !pages.has(idx) && !loadingPages.has(idx)) {
            pagesToLoad.push(idx);
          }
        }
      }

      // Process pages in order of importance (closest to current first)
      pagesToLoad.sort((a, b) => Math.abs(a - currentIndex) - Math.abs(b - currentIndex));

      for (const idx of pagesToLoad.slice(0, priority ? 2 : 4)) {
        if (loadingQueue.current.has(idx)) continue;
        
        loadingQueue.current.add(idx);
        setLoadingPages(prev => new Set(prev).add(idx));

        // Use requestIdleCallback for background loading
        const loadPage = async () => {
          try {
            const pdfPageNum = idx + 1;
            const imageData = await loadPageImage(pdfRef.current, pdfPageNum);
            
            if (imageData) {
              setPages(prev => new Map(prev).set(idx, imageData));
            }
          } catch (err) {
            console.error(`Error loading page ${idx}:`, err);
          } finally {
            setLoadingPages(prev => {
              const newSet = new Set(prev);
              newSet.delete(idx);
              return newSet;
            });
            loadingQueue.current.delete(idx);
          }
        };

        if (priority) {
          // Load immediately for visible pages
          await loadPage(); // Make this await to ensure first page loads before component shows
        } else {
          // Background loading with idle callback
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(loadPage, { timeout: 2000 });
          } else {
            setTimeout(loadPage, 50);
          }
        }
      }
    },
    [pageCount, pages, loadingPages, loadPageImage]
  );

  // 📄 Initialize PDF with better error handling
  useEffect(() => {
    let cancelled = false;
    
    async function init() {
      try {
        const pdf = await pdfjsLib.getDocument("/portfolio.pdf").promise;
        if (cancelled) return;
        
        pdfRef.current = pdf;
        const count = pdf.numPages;
        setPageCount(count);

        // Get dimensions from first page
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: SCALE });
        const ratio = vp.height / vp.width;
        
        setBaseDimensions({
          ratio,
          baseWidth: vp.width,
          baseHeight: vp.height
        });

        // Cleanup the page after getting dimensions
        page.cleanup();

        // Load the first page immediately and wait for it
        const firstPageImage = await loadPageImage(pdf, 1);
        if (!cancelled && firstPageImage) {
          setPages(prev => new Map(prev).set(0, firstPageImage));
        }

        // Now load the second page for better initial experience
        const secondPageImage = await loadPageImage(pdf, 2);
        if (!cancelled && secondPageImage) {
          setPages(prev => new Map(prev).set(1, secondPageImage));
        }

        setLoading(false);
        
        // Background load more pages after a short delay
        setTimeout(() => {
          if (!cancelled) {
            preloadPagesAround(0, false);
          }
        }, 100);
        
      } catch (err) {
        if (!cancelled) {
          console.error('PDF loading error:', err);
          setError(err.message || "Failed to load PDF");
          setLoading(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [loadPageImage]); // Add loadPageImage as dependency

  // ⌨️ Keyboard navigation with debouncing
  useEffect(() => {
    let keyTimeout;
    
    const handleKey = (e) => {
      if (!flipPageRef.current) return;
      
      clearTimeout(keyTimeout);
      keyTimeout = setTimeout(() => {
        if (e.key === "ArrowRight") flipPageRef.current.gotoNextPage();
        if (e.key === "ArrowLeft") flipPageRef.current.gotoPreviousPage();
      }, 50);
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(keyTimeout);
    };
  }, []);

  // 📏 Memoized responsive dimensions
  const pageDimensions = useMemo(() => {
    const isCover = currentPage === 0 || currentPage === pageCount - 1;
    const ratio = baseDimensions.ratio;

    const maxWidth = Math.min(window.innerWidth * 0.9, 1000);
    const maxHeight = window.innerHeight * 0.85;

    const expectedHeight = isCover
      ? maxWidth * ratio
      : maxWidth * (ratio / 2);

    let finalWidth = maxWidth;
    let finalHeight = expectedHeight;

    if (expectedHeight > maxHeight) {
      finalHeight = maxHeight;
      finalWidth = isCover
        ? maxHeight / ratio
        : maxHeight / (ratio / 2);
    }

    return { width: finalWidth, height: finalHeight };
  }, [currentPage, pageCount, baseDimensions.ratio]);

  // Handle page changes with optimized preloading
  const handlePageChange = useCallback((newPage) => {
    setCurrentPage(newPage);
    // Priority load visible pages, then background load others
    preloadPagesAround(newPage, true);
    setTimeout(() => preloadPagesAround(newPage, false), 200);
  }, [preloadPagesAround]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up any object URLs to prevent memory leaks
      pages.forEach((imageData) => {
        if (imageData.startsWith('blob:')) {
          URL.revokeObjectURL(imageData);
        }
      });
    };
  }, [pages]);

  if (loading) {
    return (
      <div style={{ 
        display: "flex", 
        justifyContent: "center", 
        alignItems: "center", 
        height: "100vh",
        fontSize: "18px"
      }}>
        <div>Loading PDF…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        display: "flex", 
        justifyContent: "center", 
        alignItems: "center", 
        height: "100vh",
        color: "red"
      }}>
        Error: {error}
      </div>
    );
  }

  return (
    <div style={{ 
      display: "flex", 
      justifyContent: "center",
      minHeight: "100vh",
      alignItems: "center"
    }}>
      <div className="bookWrap" style={{ borderRadius: "8px" }}>
        <FlipPage
          ref={flipPageRef}
          orientation="horizontal"
          width={pageDimensions.width}
          height={pageDimensions.height}
          animationDuration={400} // Slightly faster
          showSwipeHint
          uncutPages
          onPageChange={handlePageChange}
          page={currentPage}
          flipOnTouch
        >
          {Array.from({ length: pageCount }).map((_, i) => (
            <PageComponent
              key={i}
              pageIndex={i}
              pageCount={pageCount}
              imageData={pages.get(i)}
              isLoading={loadingPages.has(i)}
            />
          ))}
        </FlipPage>
      </div>
    </div>
  );
}

// Memoized page component to prevent unnecessary re-renders
const PageComponent = React.memo(({ pageIndex, pageCount, imageData, isLoading }) => {
  const isCover = pageIndex === 0;
  const isLast = pageIndex === pageCount - 1;

  return (
    <div
      className="page"
      style={{
        background: "#fff",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden"
      }}
    >
      {imageData ? (
        <img
          src={imageData}
          alt={`page-${pageIndex}`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            boxShadow:
              isCover || isLast
                ? "0 0 15px rgba(0,0,0,0.3)"
                : "none",
            borderRight:
              !isCover && !isLast && pageIndex % 2 === 0
                ? "1px solid #ccc"
                : "none"
          }}
          loading="lazy" // Native lazy loading
        />
      ) : (
        <div style={{ 
          textAlign: "center", 
          padding: "50px",
          color: "#666"
        }}>
          {isLoading ? (
            <div>
              <div style={{ marginBottom: "10px" }}>Loading page {pageIndex + 1}...</div>
              <div style={{ 
                width: "30px", 
                height: "30px", 
                border: "3px solid #f3f3f3",
                borderTop: "3px solid #3498db",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "0 auto"
              }} />
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          ) : (
            `Page ${pageIndex + 1}`
          )}
        </div>
      )}
    </div>
  );
});