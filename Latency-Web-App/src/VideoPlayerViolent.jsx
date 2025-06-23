// import React, { useState, useRef } from "react";

// const VideoPlayer = () => {
//   const [videoSrc, setVideoSrc] = useState(null);
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [isProcessing, setIsProcessing] = useState(false);
//   const [isVideoReady, setIsVideoReady] = useState(false);
//   const [processingProgress, setProcessingProgress] = useState(0);
//   const videoRef = useRef(null);
//   const fileInputRef = useRef(null);

//   const handleProcessVideo = async (file) => {
//     setIsProcessing(true);
//     setProcessingProgress(0);
//     setIsVideoReady(false);

//     try {
//       const formData = new FormData();
//       formData.append("file", file);

//       const response = await fetch("http://localhost:8000/process-video/", {
//         method: "POST",
//         body: formData,
//       });

//       if (!response.ok) {
//         throw new Error(`HTTP error! status: ${response.status}`);
//       }

//       // Simulate progress updates (since we can't get real progress from the API)
//       const progressInterval = setInterval(() => {
//         setProcessingProgress((prev) => {
//           if (prev >= 90) {
//             clearInterval(progressInterval);
//             return 90;
//           }
//           return prev + Math.random() * 10;
//         });
//       }, 500);

//       const blob = await response.blob();
//       clearInterval(progressInterval);
//       setProcessingProgress(100);

//       const url = URL.createObjectURL(blob);
//       setVideoSrc(url);

//       // Small delay to show 100% progress before showing video
//       setTimeout(() => {
//         setIsVideoReady(true);
//       }, 500);
//     } catch (error) {
//       console.error("Error processing video:", error);
//       alert("Error processing video. Please try again.");
//     } finally {
//       setIsProcessing(false);
//     }
//   };

//   const handleFileUpload = (event) => {
//     const file = event.target.files[0];
//     if (file && file.type.startsWith("video/")) {
//       // Clear any existing video URL
//       if (videoSrc) {
//         URL.revokeObjectURL(videoSrc);
//         setVideoSrc(null);
//       }

//       // Reset states
//       setIsVideoReady(false);
//       setIsPlaying(false);

//       // Process the uploaded video
//       handleProcessVideo(file);
//     } else {
//       alert("Please select a valid video file.");
//     }
//   };

//   const handlePlayPause = () => {
//     const video = videoRef.current;
//     if (isPlaying) {
//       video.pause();
//     } else {
//       video.play();
//     }
//     setIsPlaying(!isPlaying);
//   };

//   const handleUploadClick = () => {
//     // Reset the input value to allow re-uploading the same file
//     if (fileInputRef.current) {
//       fileInputRef.current.value = "";
//       fileInputRef.current.click();
//     }
//   };

//   const handleNewUpload = () => {
//     // Clear current video and show upload area
//     if (videoSrc) {
//       URL.revokeObjectURL(videoSrc);
//     }
//     setVideoSrc(null);
//     setIsPlaying(false);
//     setIsVideoReady(false);
//     setProcessingProgress(0);
//   };

//   const handleVideoLoad = () => {
//     // This ensures the video is fully loaded before allowing playback
//     console.log("Video loaded and ready to play");
//   };

//   return (
//     <div style={styles.container}>
//       <h1 style={styles.title}>Violence Detection Video Analyzer</h1>

//       {!videoSrc && !isProcessing ? (
//         <div style={styles.uploadArea} onClick={handleUploadClick}>
//           <div style={styles.uploadIcon}>📹</div>
//           <p style={styles.uploadText}>Click to upload video</p>
//           <p style={styles.uploadSubtext}>
//             Supported formats: MP4, AVI, MOV, WebM (Max: 100MB)
//           </p>
//           <input
//             ref={fileInputRef}
//             type="file"
//             accept="video/*"
//             onChange={handleFileUpload}
//             style={styles.hiddenInput}
//           />
//         </div>
//       ) : isProcessing ? (
//         <div style={styles.processingArea}>
//           <div style={styles.spinner}></div>
//           <p style={styles.processingText}>
//             Processing video for violence detection...
//           </p>
//           <div style={styles.progressBar}>
//             <div
//               style={{
//                 ...styles.progressFill,
//                 width: `${processingProgress}%`,
//               }}></div>
//           </div>
//           <p style={styles.processingSubtext}>
//             {processingProgress < 100
//               ? `${Math.round(
//                   processingProgress
//                 )}% - Analyzing frames for violent content...`
//               : "Processing complete! Preparing video..."}
//           </p>
//         </div>
//       ) : videoSrc && !isVideoReady ? (
//         <div style={styles.processingArea}>
//           <div style={styles.checkIcon}>✅</div>
//           <p style={styles.processingText}>Video processed successfully!</p>
//           <p style={styles.processingSubtext}>Preparing playback...</p>
//         </div>
//       ) : (
//         <div style={styles.videoContainer}>
//           <div style={styles.videoHeader}>
//             <h3 style={styles.videoTitle}>
//               Processed Video - Violence Detection Results
//             </h3>
//           </div>
//           <video
//             ref={videoRef}
//             src={videoSrc}
//             style={styles.video}
//             controls={false} // Remove browser controls for more control
//             onLoadedData={handleVideoLoad}
//             onPlay={() => setIsPlaying(true)}
//             onPause={() => setIsPlaying(false)}
//             preload="metadata"
//           />
//           <div style={styles.controls}>
//             <button style={styles.playButton} onClick={handlePlayPause}>
//               {isPlaying ? "⏸️ Pause" : "▶️ Play Analyzed Video"}
//             </button>
//             <div style={styles.controlsRight}>
//               <button
//                 style={styles.downloadButton}
//                 onClick={() => {
//                   const a = document.createElement("a");
//                   a.href = videoSrc;
//                   a.download = "violence-detection-analysis.mp4";
//                   a.click();
//                 }}>
//                 💾 Download
//               </button>
//               <button style={styles.uploadButton} onClick={handleNewUpload}>
//                 📤 Upload New Video
//               </button>
//             </div>
//           </div>
//           <div style={styles.infoPanel}>
//             <p style={styles.infoText}>
//               <strong>Analysis Complete:</strong> The video has been processed
//               for violence detection. Red indicators show violent content, green
//               indicates non-violent content.
//             </p>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// const styles = {
//   container: {
//     maxWidth: "900px",
//     margin: "0 auto",
//     padding: "20px",
//     fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
//     backgroundColor: "#f8f9fa",
//     minHeight: "100vh",
//   },
//   title: {
//     textAlign: "center",
//     marginBottom: "30px",
//     color: "#2c3e50",
//     fontSize: "28px",
//     fontWeight: "bold",
//   },
//   uploadArea: {
//     border: "3px dashed #6c757d",
//     borderRadius: "12px",
//     padding: "60px 20px",
//     textAlign: "center",
//     cursor: "pointer",
//     backgroundColor: "white",
//     transition: "all 0.3s ease",
//     boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
//   },
//   processingArea: {
//     border: "2px solid #007bff",
//     borderRadius: "12px",
//     padding: "60px 20px",
//     textAlign: "center",
//     backgroundColor: "white",
//     boxShadow: "0 4px 15px rgba(0,0,0,0.1)",
//   },
//   spinner: {
//     width: "50px",
//     height: "50px",
//     border: "5px solid #f3f3f3",
//     borderTop: "5px solid #007bff",
//     borderRadius: "50%",
//     animation: "spin 1s linear infinite",
//     margin: "0 auto 20px",
//   },
//   checkIcon: {
//     fontSize: "50px",
//     marginBottom: "20px",
//   },
//   processingText: {
//     fontSize: "20px",
//     color: "#2c3e50",
//     margin: "0 0 20px 0",
//     fontWeight: "bold",
//   },
//   processingSubtext: {
//     fontSize: "14px",
//     color: "#6c757d",
//     margin: "10px 0 0 0",
//   },
//   progressBar: {
//     width: "100%",
//     height: "8px",
//     backgroundColor: "#e9ecef",
//     borderRadius: "4px",
//     overflow: "hidden",
//     margin: "20px 0",
//   },
//   progressFill: {
//     height: "100%",
//     backgroundColor: "#007bff",
//     transition: "width 0.3s ease",
//   },
//   uploadIcon: {
//     fontSize: "64px",
//     marginBottom: "15px",
//   },
//   uploadText: {
//     fontSize: "20px",
//     color: "#495057",
//     margin: "0 0 10px 0",
//     fontWeight: "600",
//   },
//   uploadSubtext: {
//     fontSize: "14px",
//     color: "#6c757d",
//     margin: "0",
//   },
//   hiddenInput: {
//     display: "none",
//   },
//   videoContainer: {
//     backgroundColor: "white",
//     borderRadius: "12px",
//     overflow: "hidden",
//     boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
//   },
//   videoHeader: {
//     backgroundColor: "#343a40",
//     padding: "15px 20px",
//     color: "white",
//   },
//   videoTitle: {
//     margin: "0",
//     fontSize: "18px",
//     fontWeight: "600",
//   },
//   video: {
//     width: "100%",
//     height: "auto",
//     display: "block",
//     backgroundColor: "#000",
//   },
//   controls: {
//     padding: "20px",
//     backgroundColor: "#f8f9fa",
//     display: "flex",
//     gap: "15px",
//     alignItems: "center",
//     borderTop: "1px solid #dee2e6",
//   },
//   controlsRight: {
//     marginLeft: "auto",
//     display: "flex",
//     gap: "10px",
//   },
//   playButton: {
//     backgroundColor: "#28a745",
//     color: "white",
//     border: "none",
//     padding: "12px 24px",
//     borderRadius: "6px",
//     cursor: "pointer",
//     fontSize: "16px",
//     fontWeight: "600",
//     transition: "background-color 0.2s",
//   },
//   downloadButton: {
//     backgroundColor: "#17a2b8",
//     color: "white",
//     border: "none",
//     padding: "10px 16px",
//     borderRadius: "6px",
//     cursor: "pointer",
//     fontSize: "14px",
//     fontWeight: "500",
//   },
//   uploadButton: {
//     backgroundColor: "#6f42c1",
//     color: "white",
//     border: "none",
//     padding: "10px 16px",
//     borderRadius: "6px",
//     cursor: "pointer",
//     fontSize: "14px",
//     fontWeight: "500",
//   },
//   infoPanel: {
//     padding: "15px 20px",
//     backgroundColor: "#e3f2fd",
//     borderTop: "1px solid #bbdefb",
//   },
//   infoText: {
//     margin: "0",
//     fontSize: "14px",
//     color: "#1565c0",
//     lineHeight: "1.5",
//   },
// };

// // Add CSS animation for spinner
// const styleSheet = document.createElement("style");
// styleSheet.type = "text/css";
// styleSheet.innerText = `
//   @keyframes spin {
//     0% { transform: rotate(0deg); }
//     100% { transform: rotate(360deg); }
//   }

//   button:hover {
//     opacity: 0.9;
//     transform: translateY(-1px);
//   }

//   .upload-area:hover {
//     border-color: #007bff;
//     background-color: #f8f9fa;
//   }
// `;
// document.head.appendChild(styleSheet);

// export default VideoPlayer;
