import { motion } from "framer-motion";

const SocialProof = () => {
  const stats = [
    { value: "1.234", label: "traders ativos" },
    { value: "89%", label: "de precisão em sinais" },
    { value: "R$2.3M", label: "em lucros gerados" },
  ];

  return (
    <section className="py-12 bg-muted/20">
      <div className="container">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.5 }}
          className="grid grid-cols-1 gap-8 text-center md:grid-cols-3"
        >
          {stats.map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <p className="text-4xl font-bold text-primary font-mono">{stat.value}</p>
              <p className="mt-2 text-muted-foreground">{stat.label}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default SocialProof;
