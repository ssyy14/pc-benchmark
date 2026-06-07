import { createRouter, createMemoryHistory } from 'vue-router'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/cpu', name: 'cpu', component: () => import('../views/CpuBenchmark.vue') },
    { path: '/memory', name: 'memory', component: () => import('../views/MemoryBenchmark.vue') },
    { path: '/disk', name: 'disk', component: () => import('../views/DiskBenchmark.vue') },
    { path: '/gpu', name: 'gpu', component: () => import('../views/GpuBenchmark.vue') },
    { path: '/graphics', name: 'graphics', component: () => import('../views/GraphicsBenchmark.vue') },
    { path: '/report', name: 'report', component: () => import('../views/ReportView.vue') },
  ],
})

export default router
