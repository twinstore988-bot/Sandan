import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Upload, FileText, MessageSquare, Send, Loader2, X, Info, Sparkles, HelpCircle, Download } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini API
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const FEE_DEFINITIONS = `
بعض المعلومات للشرح:
عمولة التأجير (Leasing commission):
عمولة نظير تأجير الوحدة، عبارة عن 3% من قيمة العقد لمرة واحدة، ولا يتم احتسابها حين يتم تجديد العقد لنفس المستأجر.

رسوم إدارة الوحدة (Property Management Fee):
عمولة 5% من الإيجارات المحصلة فعليا، نظير إدارة الوحدة ومتابعة المستأجر ومستحقات الإيجار وفواتير الكهرباء والمياه والصيانة، ومتباعة المستأجر المتعثر عن السداد قانونيا.

ضريبة القيمة المضافة (VAT):
ضريبة حكومية 5% من عمولة التأجير وإدارة الوحدة، يتم تحصيلها من قبل جهاز الضرائب.

رسوم البلدية (Municipal Fee):
رسوم حكومية لإبرام العقد البلدي، عبارة عن 3% من قيمة العقد الإجمالية.

الرسوم المجتمعية (Community Charge):
هي رسوم مجتمع مدينة سندان السنوية، يتم احتسابها حسب نوع الوحدة ومساحتها نظير مصاريف خدمات المدينة العامة المتوقعة لتلك السنة، كالصيانة الخارجية، والكهرباء والمياه والصرف الصحي العامة، وجمع النفايات والتنظيف وغيرها.

رسوم الصيانة (Maintenance):
رسوم صيانة الوحدة عند يتطلّب إجراءها، كتركيب مكيف أو صيانته، أو صيانة الوحدة أو دورة المياه.
`;

interface Message {
  role: 'user' | 'model';
  text: string;
}

export default function App() {
  const [fileData, setFileData] = useState<{ data: string, type: string, name: string } | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const downloadAnalysis = async () => {
    if (!analysis) return;
    
    const { default: jsPDF } = await import('jspdf');
    const { default: html2canvas } = await import('html2canvas');
    
    const element = document.getElementById('analysis-content');
    if (!element) return;

    document.body.classList.add('generating-pdf');

    try {
      // Create a standard width for the capture to ensure A4 layout consistency
      const captureWidth = 800;
      
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: captureWidth,
        onclone: (clonedDoc) => {
          const clonedElement = clonedDoc.getElementById('analysis-content');
          if (clonedElement) {
            clonedElement.style.width = `${captureWidth}px`;
            clonedElement.style.maxWidth = 'none';
            clonedElement.style.padding = '60px';
            // Force print-only elements to be visible in the clone
            const printOnly = clonedElement.querySelectorAll('.print-only');
            printOnly.forEach((el: any) => {
              el.style.display = 'flex';
              el.style.visibility = 'visible';
            });
          }
        }
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      // Calculate image height in mm to fit A4 width
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      // First page
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      // Subsequent pages if content is long
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      
      pdf.save(`تحليل-سندان-${fileData?.name.split('.')[0] || 'فاتورة'}.pdf`);
    } catch (error) {
      console.error("PDF generation error:", error);
      // Fallback to text if PDF fails
      const textElement = document.createElement("a");
      const file = new Blob([analysis], { type: 'text/plain;charset=utf-8' });
      textElement.href = URL.createObjectURL(file);
      textElement.download = `تحليل-سندان-${fileData?.name.split('.')[0] || 'فاتورة'}.txt`;
      document.body.appendChild(textElement);
      textElement.click();
      document.body.removeChild(textElement);
    } finally {
      document.body.classList.remove('generating-pdf');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setFileData({ data: base64, type: file.type, name: file.name });
        analyzeInvoice(base64, file.type);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeInvoice = async (base64Data: string, mimeType: string) => {
    setLoading(true);
    setAnalysis(null);
    setChatMessages([]);
    try {
      const model = "gemini-3-flash-preview";
      const prompt = `
        أنت خبير مالي في شركة مدينة سندان. قم بتحليل ملف الفاتورة (Credit Note) المرفق.
        اشرح للمالك بالتفصيل المبالغ المذكورة في قسم "الإستقطاعات" (Deductions) بناءً على القواعد التالية:
        ${FEE_DEFINITIONS}
        
        يرجى تقديم الشرح باللغة العربية بأسلوب مهني وواضح. 
        تأكد من ذكر الأرقام المحددة الموجودة في الفاتورة وربطها بالشرح.
        إذا كان هناك مبلغ 0.000 في أي خانة، وضح للمالك سبب ذلك (مثلاً: لم يتم احتساب عمولة التأجير لأن العقد تم تجديده).
        استخدم التنسيق الجميل (Markdown) مع عناوين ونقاط واضحة.
      `;

      const filePart = {
        inlineData: {
          mimeType: mimeType,
          data: base64Data.split(',')[1],
        },
      };

      const response = await genAI.models.generateContent({
        model,
        contents: [{ parts: [filePart, { text: prompt }] }],
      });

      setAnalysis(response.text || "عذراً، لم أتمكن من تحليل الفاتورة.");
    } catch (error) {
      console.error("Analysis error:", error);
      setAnalysis("حدث خطأ أثناء تحليل الفاتورة. يرجى المحاولة مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !fileData) return;

    const userMessage: Message = { role: 'user', text: inputText };
    setChatMessages(prev => [...prev, userMessage]);
    setInputText('');
    setChatLoading(true);

    try {
      const model = "gemini-3-flash-preview";
      const history = chatMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const filePart = {
        inlineData: {
          mimeType: fileData.type,
          data: fileData.data.split(',')[1],
        },
      };

      const response = await genAI.models.generateContent({
        model,
        contents: [
          { parts: [filePart, { text: `سياق الفاتورة والقواعد: ${FEE_DEFINITIONS}\n\nالتحليل السابق: ${analysis}` }] },
          ...history,
          { parts: [{ text: inputText }] }
        ],
      });

      const modelMessage: Message = { role: 'model', text: response.text || "عذراً، لم أتمكن من الرد." };
      setChatMessages(prev => [...prev, modelMessage]);
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages(prev => [...prev, { role: 'model', text: "حدث خطأ أثناء معالجة سؤالك." }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen font-sans selection:bg-brand/20" dir="rtl">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/70 backdrop-blur-xl border-b border-brand/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <motion.div 
              initial={{ rotate: -10, scale: 0.9 }}
              animate={{ rotate: 0, scale: 1 }}
              className="w-12 h-12 bg-brand rounded-2xl flex items-center justify-center text-white shadow-lg shadow-brand/20"
            >
              <FileText size={24} />
            </motion.div>
            <div>
              <h1 className="font-bold text-xl tracking-tight text-brand">سندان الذكي</h1>
              <p className="text-[10px] uppercase tracking-widest text-brand/40 font-semibold">Smart Invoice Explainer</p>
            </div>
          </div>
          
          <AnimatePresence>
            {fileData && (
              <motion.button
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                onClick={() => { setFileData(null); setAnalysis(null); setChatMessages([]); }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-all"
              >
                <X size={16} />
                <span>إلغاء الملف</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </nav>

      <main className="pt-28 md:pt-32 pb-20 px-4 md:px-6 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {!fileData ? (
            <motion.div
              key="upload-state"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <div className="text-center mb-16">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand/5 text-brand text-xs font-bold mb-6"
                >
                  <Sparkles size={14} />
                  <span>مدعوم بالذكاء الاصطناعي</span>
                </motion.div>
                <h2 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight leading-[1.1]">
                  افهم فواتيرك <br />
                  <span className="text-brand italic font-serif">بكل بساطة ووضوح</span>
                </h2>
                <p className="text-lg text-brand/60 max-w-xl mx-auto leading-relaxed">
                  ارفع فاتورة مدينة سندان وسنقوم بشرح كل هللة مستقطعة بالتفصيل الممل، مع إمكانية الدردشة للاستفسار.
                </p>
              </div>

              <label className="group relative block cursor-pointer">
                <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileUpload} />
                <motion.div 
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="relative overflow-hidden rounded-[40px] p-1 bg-gradient-to-br from-brand/20 via-brand/5 to-brand/20 shadow-2xl"
                >
                  <div className="bg-white rounded-[38px] p-10 md:p-24 text-center border border-white/50">
                    <div className="w-20 h-20 md:w-24 md:h-24 bg-brand-light rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
                      <Upload className="text-brand" size={32} />
                    </div>
                    <p className="text-xl md:text-2xl font-bold mb-3">اسحب الفاتورة هنا</p>
                    <p className="text-brand/40 font-medium text-sm md:text-base">يدعم الصور وملفات الـ PDF</p>
                    
                    <div className="mt-10 flex items-center justify-center gap-4">
                      <div className="flex -space-x-3 rtl:space-x-reverse">
                        {[1,2,3].map(i => (
                          <div key={i} className="w-10 h-10 rounded-full border-2 border-white bg-brand-muted" />
                        ))}
                      </div>
                      <p className="text-xs text-brand/60 font-medium">انضم لـ +1,000 مالك يستخدمون النظام</p>
                    </div>
                  </div>
                </motion.div>
              </label>

              <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  { icon: Sparkles, title: "تحليل ذكي", desc: "فهم عميق لكل بنود المخصومات والرسوم." },
                  { icon: HelpCircle, title: "دردشة فورية", desc: "اسأل عن أي تفصيل وسنجيبك في الحال." },
                  { icon: Info, title: "دقة متناهية", desc: "مبني على أحدث نماذج الذكاء الاصطناعي." }
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + i * 0.1 }}
                    className="p-8 rounded-3xl bg-white border border-brand/5 shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="w-12 h-12 bg-brand/5 rounded-2xl flex items-center justify-center text-brand mb-6">
                      <item.icon size={24} />
                    </div>
                    <h3 className="font-bold text-lg mb-3">{item.title}</h3>
                    <p className="text-sm text-brand/50 leading-relaxed">{item.desc}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="analysis-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start"
            >
              {/* Left Side: Preview & Analysis */}
              <div className="lg:col-span-7 space-y-8">
                <motion.div 
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className="rounded-[32px] overflow-hidden bg-white shadow-2xl border border-brand/5"
                >
                  <div className="p-4 bg-brand-muted/30 border-b border-brand/5 flex items-center justify-between">
                    <span className="text-xs font-bold text-brand/40 truncate max-w-[200px]">{fileData.name}</span>
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-red-400/20" />
                      <div className="w-2 h-2 rounded-full bg-yellow-400/20" />
                      <div className="w-2 h-2 rounded-full bg-green-400/20" />
                    </div>
                  </div>
                  <div className="p-4 md:p-6">
                    {fileData.type.startsWith('image/') ? (
                      <img src={fileData.data} alt="Invoice" className="w-full h-auto rounded-2xl shadow-sm" />
                    ) : (
                      <div className="aspect-[4/3] flex flex-col items-center justify-center bg-brand-light rounded-2xl border border-brand/5">
                        <FileText size={48} className="text-brand/20 mb-6" />
                        <p className="font-bold text-brand/60 text-sm">مستند PDF</p>
                      </div>
                    )}
                  </div>
                </motion.div>

                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="bg-white rounded-[32px] p-6 md:p-10 shadow-xl border border-brand/5"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 md:w-12 md:h-12 bg-brand rounded-2xl flex items-center justify-center text-white shrink-0">
                        <Sparkles size={20} />
                      </div>
                      <h3 className="text-xl md:text-2xl font-bold tracking-tight">شرح المخصومات</h3>
                    </div>
                    
                    {analysis && !loading && (
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={downloadAnalysis}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand/5 text-brand text-sm font-bold hover:bg-brand/10 transition-all w-full md:w-auto"
                      >
                        <Download size={18} />
                        <span>تحميل التحليل</span>
                      </motion.button>
                    )}
                  </div>
                  
                  {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center text-brand/30">
                      <Loader2 className="animate-spin mb-6" size={48} />
                      <p className="font-medium animate-pulse">جاري قراءة الفاتورة وتحليلها...</p>
                    </div>
                  ) : (
                    <div id="analysis-content" className="p-4 md:p-8 bg-white rounded-xl prose prose-brand max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-p:text-brand/70 prose-p:leading-relaxed prose-strong:text-brand prose-ul:list-disc prose-li:text-brand/60 text-sm md:text-base">
                      {/* PDF Header (Hidden in UI) */}
                      <div className="hidden print-only mb-8 pb-6 border-b-2 border-brand/10 flex items-center justify-between">
                        <div>
                          <h1 className="text-2xl font-bold text-brand m-0">سندان الذكي</h1>
                          <p className="text-xs text-brand/40 m-0">تقرير تحليل الفاتورة</p>
                        </div>
                        <div className="text-left">
                          <p className="text-xs text-brand/40 m-0">{new Date().toLocaleDateString('ar-OM')}</p>
                        </div>
                      </div>
                      
                      <Markdown>{analysis || ""}</Markdown>
                      
                      {/* PDF Footer (Hidden in UI) */}
                      <div className="hidden print-only mt-12 pt-6 border-t border-brand/5 text-center">
                        <p className="text-[10px] text-brand/30 m-0">تم إنشاء هذا التقرير بواسطة ذكاء سندان الاصطناعي</p>
                      </div>
                    </div>
                  )}
                </motion.div>
              </div>

              {/* Right Side: Chat */}
              <div className="lg:col-span-5 lg:sticky lg:top-28">
                <motion.div
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="bg-white rounded-[32px] shadow-2xl border border-brand/5 flex flex-col h-[500px] md:h-[700px] overflow-hidden"
                >
                  <div className="p-6 md:p-8 border-b border-brand/5 bg-brand-light/50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-brand/10 rounded-xl flex items-center justify-center text-brand">
                        <MessageSquare size={20} />
                      </div>
                      <div>
                        <h3 className="font-bold text-brand text-sm md:text-base">مساعدك الشخصي</h3>
                        <p className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse" />
                          نشط الآن
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar">
                    {chatMessages.length === 0 && !chatLoading && (
                      <div className="h-full flex flex-col items-center justify-center text-center px-6">
                        <div className="w-16 h-16 bg-brand/5 rounded-full flex items-center justify-center text-brand/20 mb-6">
                          <HelpCircle size={32} />
                        </div>
                        <p className="font-bold text-brand/40 mb-2">هل لديك استفسار؟</p>
                        <p className="text-xs text-brand/30 leading-relaxed">
                          يمكنك سؤالي عن أي بند في الفاتورة أو طلب توضيح أكثر حول المبالغ المستقطعة.
                        </p>
                      </div>
                    )}
                    
                    {chatMessages.map((msg, i) => (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        key={i} 
                        className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
                      >
                        <div className={`max-w-[90%] p-5 rounded-[24px] text-sm leading-relaxed shadow-sm ${
                          msg.role === 'user' 
                            ? 'bg-brand-muted/40 text-brand rounded-tr-none' 
                            : 'bg-brand text-white rounded-tl-none'
                        }`}>
                          <Markdown>{msg.text}</Markdown>
                        </div>
                      </motion.div>
                    ))}
                    
                    {chatLoading && (
                      <div className="flex justify-end">
                        <div className="bg-brand text-white p-5 rounded-[24px] rounded-tl-none flex items-center gap-3 shadow-lg shadow-brand/10">
                          <Loader2 className="animate-spin" size={16} />
                          <span className="text-xs font-medium">جاري التفكير...</span>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="p-4 md:p-6 bg-white border-t border-brand/5">
                    <div className="relative group">
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder="اسأل عن أي بند..."
                        className="w-full bg-brand-light border-2 border-transparent rounded-2xl py-4 md:py-5 pr-6 pl-14 md:pl-16 text-sm focus:border-brand/10 focus:bg-white transition-all outline-none shadow-inner"
                      />
                      <button
                        onClick={handleSendMessage}
                        disabled={!inputText.trim() || chatLoading}
                        className="absolute left-1.5 md:left-2 top-1.5 md:top-2 bottom-1.5 md:bottom-2 w-10 h-10 md:w-12 md:h-12 bg-brand text-white rounded-xl flex items-center justify-center hover:bg-brand/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-brand/20"
                      >
                        <Send size={18} className="rotate-180" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="py-12 border-t border-brand/5 bg-white/50">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3 opacity-40">
            <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center text-white">
              <FileText size={16} />
            </div>
            <span className="font-bold text-sm tracking-tight">سندان الذكي</span>
          </div>
          <p className="text-xs text-brand/30 font-medium">© 2026 مدينة سندان - جميع الحقوق محفوظة</p>
          <div className="flex items-center gap-8">
            {['سياسة الخصوصية', 'شروط الاستخدام', 'اتصل بنا'].map(link => (
              <a key={link} href="#" className="text-xs text-brand/30 hover:text-brand font-medium transition-colors">{link}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
