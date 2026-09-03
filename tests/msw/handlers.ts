import { http, HttpResponse } from 'msw';

export const handlers = [
  // Mock Katana GET materials
  http.get('https://api.katanamrp.com/v1/materials', () => {
    return HttpResponse.json({
      data: [
        {
          id: 123,
          sku: 'MOCK-KATANA-SKU',
          name: 'Mock Material',
        }
      ]
    });
  }),
  
  // Mock Katana POST material
  http.post('https://api.katanamrp.com/v1/materials', async ({ request }) => {
    const body = await request.json();
    console.log('[QA MSW] Intercepted Katana Material POST:', body);
    return HttpResponse.json({
      id: 999,
      ...body as any
    }, { status: 201 });
  }),
];
