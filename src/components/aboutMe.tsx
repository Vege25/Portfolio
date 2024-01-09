import React from 'react';
import MySkills from './mySkills';

const AboutMe: React.FC = () => {
  return (
    <section id='skillsElement'>
      <h2 className='text-3xl font-bold text-center'>ABOUT ME</h2>
      <div className='w-10 h-1 m-auto my-5 rounded-full bg-lightBlue'></div>
      <div className='px-5 my-10 lg:grid lg:grid-cols-2 lg:gap-4 md:grid md:grid-cols-1'>
        <div className=''>
          <h3 className='my-4 text-xl font-bold'>Get to know me</h3>
          <div className='w-3/4 md:full'>
            <p className='py-1'>
              As a full-stack web developer, I leverage a diverse skill set to
              engineer seamless and innovative digital experiences.
            </p>
            <p className='py-1'>
              From designing user-friendly interfaces to constructing robust
              backend systems, my commitment is to exceed expectations with
              every solution.
            </p>
          </div>
        </div>
        <MySkills />
      </div>
    </section>
  );
};

export default AboutMe;
