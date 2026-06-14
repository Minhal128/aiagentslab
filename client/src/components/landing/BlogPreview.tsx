/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
import { motion } from "framer-motion";
import { ArrowRight, Clock, Calendar } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const blogImg1 = "/images/stock_images/ai_technology_busine_e2087a76.jpg";
const blogImg2 = "/images/stock_images/ai_technology_busine_ab1329af.jpg";
const blogImg3 = "/images/stock_images/ai_technology_busine_5f811b86.jpg";
const blogImg4 = "/images/stock_images/ai_technology_busine_51895c91.jpg";
const blogImg5 = "/images/stock_images/ai_technology_busine_1e218027.jpg";
const blogImg6 = "/images/stock_images/ai_technology_busine_c8311ea3.jpg";
const blogImg7 = "/images/stock_images/ai_technology_busine_438e6bc2.jpg";
const blogImg8 = "/images/stock_images/ai_technology_busine_482a3692.jpg";

interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  categoryColor: string;
  readTime: string;
  date: string;
  image: string;
}

const articles: Article[] = [
  {
    id: "1",
    slug: "ai-voice-agents-customer-service",
    title: "How AI Voice Agents Are Transforming Customer Service in 2025",
    excerpt: "Discover how businesses are leveraging AI-powered voice agents to deliver 24/7 customer support with human-like conversations and reduce operational costs.",
    category: "AI Technology",
    categoryColor: "bg-blue-500/90 text-white",
    readTime: "5 min read",
    date: "Nov 25, 2025",
    image: blogImg1,
  },
  {
    id: "2",
    slug: "case-study-cost-reduction",
    title: "Case Study: 65% Cost Reduction with Automated AI Calling",
    excerpt: "Learn how GlobalCom Enterprise reduced operational costs by 65% while improving customer satisfaction scores with AI voice agents.",
    category: "Case Studies",
    categoryColor: "bg-emerald-500/90 text-white",
    readTime: "8 min read",
    date: "Nov 20, 2025",
    image: blogImg2,
  },
  {
    id: "3",
    slug: "introducing-flow-agents",
    title: "Introducing Flow Agents: Visual Call Scripting Made Easy",
    excerpt: "Build complex call flows with our new visual editor. No coding required—just drag, drop, and deploy your AI voice agents in minutes.",
    category: "Product Updates",
    categoryColor: "bg-purple-500/90 text-white",
    readTime: "4 min read",
    date: "Nov 18, 2025",
    image: blogImg3,
  },
  {
    id: "4",
    slug: "best-practices-training-ai-agent",
    title: "Best Practices for AI-Powered Lead Qualification Calls",
    excerpt: "Master the art of AI lead qualification with proven techniques that help you identify high-value prospects and boost conversion rates by 40%.",
    category: "Best Practices",
    categoryColor: "bg-amber-500/90 text-white",
    readTime: "6 min read",
    date: "Nov 15, 2025",
    image: blogImg4,
  },
  {
    id: "5",
    slug: "roi-calculator-ai-calling",
    title: "The Future of Conversational AI: Trends to Watch in 2025",
    excerpt: "Explore emerging trends in conversational AI, from emotion detection to multi-language support, and how they'll shape customer interactions.",
    category: "Industry Insights",
    categoryColor: "bg-cyan-500/90 text-white",
    readTime: "7 min read",
    date: "Nov 12, 2025",
    image: blogImg5,
  },
  {
    id: "6",
    slug: "multi-language-support",
    title: "Complete Guide to AI-Powered Appointment Scheduling",
    excerpt: "Learn how to set up AI voice agents that handle appointment booking, rescheduling, and reminders—reducing no-shows by up to 60%.",
    category: "Tutorials",
    categoryColor: "bg-rose-500/90 text-white",
    readTime: "10 min read",
    date: "Nov 10, 2025",
    image: blogImg6,
  },
  {
    id: "7",
    slug: "enterprise-security-compliance",
    title: "Measuring ROI: How to Calculate Your AI Voice Agent Impact",
    excerpt: "A comprehensive framework for measuring the return on investment of your AI calling automation, with real metrics and benchmarks.",
    category: "Business Strategy",
    categoryColor: "bg-indigo-500/90 text-white",
    readTime: "6 min read",
    date: "Nov 8, 2025",
    image: blogImg7,
  },
  {
    id: "8",
    slug: "healthcare-appointment-scheduling",
    title: "ElevenLabs + Twilio Integration: A Technical Deep Dive",
    excerpt: "Technical walkthrough of integrating ElevenLabs' conversational AI with Twilio's phone infrastructure for seamless voice experiences.",
    category: "Technical Guides",
    categoryColor: "bg-slate-600/90 text-white",
    readTime: "12 min read",
    date: "Nov 5, 2025",
    image: blogImg8,
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      delay: index * 0.1,
      ease: [0.25, 0.4, 0.25, 1],
    },
  }),
};

interface ArticleCardProps {
  article: Article;
  index: number;
}

function ArticleCard({ article, index }: ArticleCardProps) {
  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      data-testid={`card-article-${article.id}`}
    >
      <Link href={`/blog/${article.slug}`}>
        <Card className="rounded-2xl overflow-hidden hover-elevate transition-all h-full group cursor-pointer">
          <div className="relative aspect-video overflow-hidden">
            <img 
              src={article.image} 
              alt={article.title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              data-testid={`img-article-${article.id}`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <Badge 
              className={`absolute top-4 left-4 ${article.categoryColor} border-0 shadow-lg`}
              data-testid={`badge-category-${article.id}`}
            >
              {article.category}
            </Badge>
          </div>
          
          <div className="p-5 space-y-3">
            <h3 
              className="text-lg font-bold line-clamp-2 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors"
              data-testid={`title-article-${article.id}`}
            >
              {article.title}
            </h3>
            
            <p 
              className="text-sm text-muted-foreground leading-relaxed line-clamp-2"
              data-testid={`excerpt-article-${article.id}`}
            >
              {article.excerpt}
            </p>
            
            <div 
              className="flex items-center gap-4 text-xs text-muted-foreground pt-1"
              data-testid={`meta-article-${article.id}`}
            >
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>{article.readTime}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                <span>{article.date}</span>
              </div>
            </div>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}

export function BlogPreview() {
  return (
    <section
      id="blog"
      className="py-24 md:py-32 relative overflow-hidden"
      data-testid="section-blog-preview"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-slate-100/50 via-transparent to-slate-200/30 dark:from-slate-900/50 dark:via-transparent dark:to-slate-800/30" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-4 mb-16"
        >
          <h2
            className="text-4xl md:text-5xl font-bold"
            data-testid="heading-blog-preview"
          >
            Resources & Insights
          </h2>
          <p 
            className="text-xl text-muted-foreground max-w-3xl mx-auto"
            data-testid="subheading-blog-preview"
          >
            Stay ahead with the latest AI voice agent strategies, case studies, and product updates
          </p>
        </motion.div>

        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12"
          data-testid="grid-articles"
        >
          {articles.map((article, index) => (
            <ArticleCard
              key={article.id}
              article={article}
              index={index}
            />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-center"
        >
          <Link href="/blog">
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-8 text-base group"
              data-testid="button-view-all-articles"
            >
              View All Articles
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform duration-200" />
            </Button>
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

export default BlogPreview;
