import React, { FormEvent, useState } from 'react';

const ContactComponent: React.FC = () => {
  const [formData, setFormData] = useState({
    subject: '',
    name: '',
    message: '',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const subject = encodeURIComponent(formData.subject);
    const body = encodeURIComponent(`${formData.message} 
- ${formData.name}
    `);

    const mailtoLink = `mailto:v.sorakivi@gmail.com?subject=${subject}&body=${body}`;

    // Create a hidden link element
    const link = document.createElement('a');
    link.href = mailtoLink;

    // Trigger a click on the link
    link.click();
  };

  return (
    <section
      id='contactElement'
      className='flex flex-col items-center justify-center gap-10 md:flex-row'
    >
      <div className='w-full px-10 sm:pl-4 sm:w-1/2'>
        <h2 className='text-5xl font-bold text-nowrap text-lightBlue'>
          Let's chat
        </h2>
        <p className='pt-2 text-lightGray'>
          Let's connect and turn your ideas into reality. I'm looking forward to
          hearing from you!
        </p>
      </div>
      <div className='flex items-center justify-center'>
        <div className='max-w-md p-8 rounded-md shadow-lg bg-lightGray bg-opacity-10'>
          <h2 className='mb-6 text-2xl font-bold'>Send me a message</h2>
          <form onSubmit={handleSubmit}>
            <div className='mb-4'>
              <label
                htmlFor='name'
                className='block text-sm font-medium text-white'
              >
                Name
              </label>
              <input
                type='text'
                id='name'
                name='name'
                value={formData.name}
                onChange={handleChange}
                className='w-full p-2 mt-1 text-black border rounded-md focus:outline-none focus:ring focus:border-lightBlue'
                required
              />
            </div>
            <div className='mb-4'>
              <label
                htmlFor='subject'
                className='block text-sm font-medium text-white'
              >
                Subject
              </label>
              <input
                type='text'
                id='subject'
                name='subject'
                value={formData.subject}
                onChange={handleChange}
                className='w-full p-2 mt-1 text-black border rounded-md focus:outline-none focus:ring focus:border-lightBlue'
                required
              />
            </div>
            <div className='mb-6'>
              <label
                htmlFor='message'
                className='block text-sm font-medium text-white'
              >
                Message
              </label>
              <textarea
                id='message'
                name='message'
                value={formData.message}
                onChange={handleChange}
                className='w-full p-2 mt-1 text-black border rounded-md focus:outline-none focus:ring focus:border-lightBlue'
                rows={4}
                required
              ></textarea>
            </div>
            <button
              type='submit'
              className='w-full px-4 py-2 font-bold text-black transition-all duration-150 ease-in-out rounded-lg bg-lightBlue hover:scale-105'
            >
              Send Message
            </button>
          </form>
        </div>
      </div>
    </section>
  );
};

export default ContactComponent;
